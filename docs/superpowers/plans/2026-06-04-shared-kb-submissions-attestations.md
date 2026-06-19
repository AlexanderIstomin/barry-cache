# Shared KB Submissions And Attestations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-infra shared KB submission system with preview-first proposals, Git PR submission, signed validation attestations, and reputation-weighted scoring.

**Architecture:** Keep Git as the moderation and canonical submission path, Cloudflare/static snapshots as distribution, and `.barry-cache/` as local private outbox/config. Barry instances query shared KB selectively when expected savings justify lookup/context cost, create anonymized lesson proposals and signed attestations locally, then submit them through Git PRs; the shared KB build aggregates attestations into trust scores without treating raw consensus as truth.

**Tech Stack:** Bun, TypeScript, Node crypto Ed25519, JSONL, Git/GitHub CLI (`gh`) as optional submission transport, existing Barry CLI/core/test patterns.

---

## Scope

This plan implements the first useful version of the "distributed hive mind" without tokens or money. Incentives are reputation, access, and influence:

- Good submissions and accurate attestations increase validator reputation.
- Bad submissions, private leaks, copied evidence, and wrong high-confidence validations reduce reputation.
- Remote shared KB access remains gated by `share-enabled`.
- Shared KB lookup should be selective and high-profitability: query only when task uncertainty, expected failure cost, or known recurring patterns make retrieval cheaper than reinvention.
- Query results must stay top-k and concise so shared KB does not become a token sink.
- Actual outbound submit commands require `share-enabled`.
- Preview/dry-run commands work in `preview-only` and `share-enabled`.
- GitHub submission is batched: Barry must create at most one submission PR per repository per UTC day by default.
- Raw proposal and attestation records accumulate locally in the outbox until the user submits a daily batch.

Do not implement blockchain, real-money rewards, or an always-on remote service in this version.

## File Structure

- Create `src/core/shared-kb-identity.ts`
  - Creates/loads local Ed25519 validator identity in `.barry-cache/shared-kb/identity.json`.
  - Signs proposal and attestation payloads.
  - Exposes public validator ID as a hash of the public key.

- Create `src/core/shared-kb-proposal.ts`
  - Builds anonymized lesson proposals.
  - Writes local outbox records to `.barry-cache/shared-kb/outbox/*.json`.
  - Renders exact JSONL rows and PR metadata for preview/submission.

- Create `src/core/shared-kb-batch.ts`
  - Groups local outbox records into deterministic daily submission batches.
  - Tracks submission state in `.barry-cache/shared-kb/submissions.jsonl`.
  - Enforces the default one-submission-PR-per-UTC-day policy.

- Create `src/core/shared-kb-attestation.ts`
  - Validates signed attestation records.
  - Writes local attestation outbox records.
  - Verifies attestation signatures during shared KB validation/build.

- Create `src/core/shared-kb-reputation.ts`
  - Computes validator reputation and lesson scores from attestations.
  - Discounts copied/correlated evidence.
  - Produces `indexes/reputation.json` for static snapshots.

- Create `src/core/shared-kb-profitability.ts`
  - Scores whether a task should query shared KB before work.
  - Limits result count and context payload size.
  - Explains why a query was or was not considered profitable.

- Modify `src/core/shared-kb.ts`
  - Add `attestations/*.jsonl` source loading.
  - Include attestations and reputation output in validation/build.
  - Keep existing lesson/revocation behavior compatible.

- Modify `src/core/shared-kb-config.ts`
  - Add optional remote config:
    - `shared_kb.remote.search_url`
    - `shared_kb.remote.submission_repo`
  - Keep missing config defaulting to `local_only`.

- Modify `src/cli.ts`
  - Add `kb identity`.
  - Add `kb recommend-query --task "..."` for dry-run policy inspection.
  - Add `kb propose lesson`.
  - Add `kb attest`.
  - Add `kb submit --dry-run`.
  - Add `kb submit --repo owner/repo`.
  - Add `kb submit --force` only for explicit manual override of the daily PR guard.

- Modify tests:
  - `tests/shared-kb-identity.test.ts`
  - `tests/shared-kb-proposal.test.ts`
  - `tests/shared-kb-attestation.test.ts`
  - `tests/shared-kb-batch.test.ts`
  - `tests/shared-kb-reputation.test.ts`
  - `tests/shared-kb-profitability.test.ts`
  - `tests/shared-kb.test.ts`
  - `tests/cli-kb.test.ts`
  - `tests/cli-help.test.ts`

- Modify docs/context:
  - Create ADR: `docs/context/adrs/ADR-0009-use-signed-attestations-for-shared-kb-validation.md`
  - Update `docs/context/features/shared-kb/{README.md,IDMAP.md,KG.adj,FACTS.jsonl}`
  - Update `docs/shared-kb-cloudflare.md`
  - Update `README.md`

---

### Task 1: Remote Submission Config

**Files:**
- Modify: `src/core/shared-kb-config.ts`
- Test: `tests/shared-kb-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add tests:

```ts
test("stores optional shared KB remote endpoints", async () => {
  await withTempRepo(async (repo) => {
    await writeSharedKbRemoteConfig({
      repo,
      remote: {
        search_url: "https://kb.example.com/latest",
        submission_repo: "owner/barry-shared-kb",
      },
    });

    const config = await readSharedKbConfig({ repo });
    expect(config.shared_kb.remote).toEqual({
      search_url: "https://kb.example.com/latest",
      submission_repo: "owner/barry-shared-kb",
    });
  });
});

test("rejects remote submission repos that are not owner/repo names", async () => {
  await withTempRepo(async (repo) => {
    await expect(writeSharedKbRemoteConfig({
      repo,
      remote: { submission_repo: "https://github.com/owner/repo" },
    })).rejects.toThrow("submission_repo must use owner/repo format");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-config.test.ts
```

Expected: FAIL because `writeSharedKbRemoteConfig` does not exist.

- [ ] **Step 3: Implement minimal config support**

Add:

```ts
export interface SharedKbRemoteConfig {
  search_url?: string;
  submission_repo?: string;
}
```

Extend `SharedKbConfig.shared_kb` with `remote?: SharedKbRemoteConfig`.

Add:

```ts
export async function writeSharedKbRemoteConfig(options: {
  repo: string;
  remote: SharedKbRemoteConfig;
}): Promise<SharedKbConfig>
```

Validation:

- `search_url`, when present, must start with `https://`.
- `submission_repo`, when present, must match `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/shared-kb-config.test.ts
```

Expected: PASS.

---

### Task 2: High-Profitability Shared KB Query Policy

**Files:**
- Create: `src/core/shared-kb-profitability.ts`
- Modify: `src/cli.ts`
- Create: `tests/shared-kb-profitability.test.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing profitability tests**

Test behavior:

- Tasks with debugging, failed attempts, architectural decisions, security/privacy implications, unfamiliar APIs, or explicit repeated-pattern wording should recommend querying.
- Trivial edit tasks should not recommend querying.
- Recommended queries should cap results at 3 by default.
- Recommended context budget should cap at 2,500 tokens by default.
- The decision should include human-readable reasons.

Test sketch:

```ts
expect(shouldQuerySharedKb({
  task: "Fix recurring validation failure after previous agent handoff",
})).toEqual({
  query: true,
  max_results: 3,
  max_context_tokens: 2500,
  reasons: [
    "task mentions failure or validation",
    "task likely benefits from known recurring patterns",
  ],
});

expect(shouldQuerySharedKb({
  task: "Rename button label from Save to Done",
})).toEqual({
  query: false,
  max_results: 0,
  max_context_tokens: 0,
  reasons: ["task appears low-risk and cheaper to solve directly"],
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-profitability.test.ts
```

Expected: FAIL because `shared-kb-profitability.ts` does not exist.

- [ ] **Step 3: Implement profitability scorer**

Add:

```ts
export interface SharedKbQueryRecommendation {
  query: boolean;
  max_results: number;
  max_context_tokens: number;
  reasons: string[];
}

export function shouldQuerySharedKb(options: {
  task: string;
  priorFailures?: number;
  maxResults?: number;
  maxContextTokens?: number;
}): SharedKbQueryRecommendation
```

Heuristic:

- Add 3 points for explicit `priorFailures > 0`.
- Add 2 points for terms matching `failure|failed|bug|debug|regression|validation|security|privacy|auth|schema|migration|architecture|ADR|unknown|unfamiliar|recurring|handoff`.
- Add 1 point for task text longer than 160 chars.
- Subtract 2 points for trivial terms matching `rename|typo|format|copy change|label`.
- Recommend query when score is at least 2.

Defaults:

- `max_results`: 3 when querying, 0 otherwise.
- `max_context_tokens`: 2500 when querying, 0 otherwise.

- [ ] **Step 4: Add CLI policy inspection**

Command:

```bash
barry-cache kb recommend-query --task "Fix recurring validation failure" [--json]
```

Plain output:

```text
Shared KB query recommended.
Max results: 3
Max context tokens: 2500
Reasons:
  task mentions failure or validation
  task likely benefits from known recurring patterns
```

For non-profitable tasks:

```text
Shared KB query not recommended.
Reasons:
  task appears low-risk and cheaper to solve directly
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/shared-kb-profitability.test.ts tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 3: Local Signed Validator Identity

**Files:**
- Create: `src/core/shared-kb-identity.ts`
- Create: `tests/shared-kb-identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

Test behavior:

- Missing identity creates `.barry-cache/shared-kb/identity.json`.
- Re-reading returns the same validator ID.
- Sign/verify succeeds for original payload and fails for tampered payload.

Use:

```ts
const identity = await loadOrCreateSharedKbIdentity({ repo });
const signature = signSharedKbPayload(identity, { kind: "test", value: "ok" });
expect(verifySharedKbPayloadSignature({
  publicKey: identity.public_key,
  payload: { kind: "test", value: "ok" },
  signature,
})).toBe(true);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-identity.test.ts
```

Expected: FAIL because the identity module does not exist.

- [ ] **Step 3: Implement identity module**

Use Node `crypto.generateKeyPairSync("ed25519")`.

Identity file shape:

```json
{
  "version": 1,
  "algorithm": "ed25519",
  "validator_id": "validator-sha256-...",
  "public_key": "base64-pem",
  "private_key": "base64-pem",
  "created_at": "2026-06-04T00:00:00.000Z"
}
```

Canonical payload signing:

```ts
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}
```

If nested canonicalization becomes necessary, replace with a recursive stable stringify helper in the same file.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/shared-kb-identity.test.ts
```

Expected: PASS.

---

### Task 4: Preview-First Lesson Proposals

**Files:**
- Create: `src/core/shared-kb-proposal.ts`
- Modify: `src/cli.ts`
- Create: `tests/shared-kb-proposal.test.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing core proposal tests**

Test:

- `buildSharedKbLessonProposal` returns a valid `SharedKbLesson`.
- Proposal rejects revealing paths/emails/secrets by reusing `validateSharedKbLesson`.
- Proposal writes an outbox file.

Inputs:

```ts
{
  title: "Treat handoffs as claims until validated",
  problem: "Agents may trust stale handoff summaries.",
  applies_when: ["multi-agent coding workflow"],
  recommendation: "Validate claims before treating them as durable context.",
  why: "This prevents stale operational memory from becoming canonical truth.",
  avoid_when: ["the source cannot be safely anonymized"],
  tags: ["agents", "validation"],
  confidence: "medium"
}
```

- [ ] **Step 2: Write failing CLI tests**

Add CLI tests:

- `kb propose lesson ... --dry-run` works in `preview-only` and prints exact JSONL payload.
- `kb propose lesson ...` without `--dry-run` writes an outbox record in `preview-only`.
- Actual `kb submit` remains blocked until Task 8.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-proposal.test.ts tests/cli-kb.test.ts
```

Expected: FAIL because proposal APIs and CLI action do not exist.

- [ ] **Step 4: Implement proposal builder**

Lesson proposal defaults:

- `kind`: `lesson`
- `status`: `submitted`
- `evidence.source_type`: `community_report`
- `evidence.count`: `1`
- `updated_at`: current ISO timestamp
- `id`: `lesson-YYYYMMDD-<8 char hash>`

Outbox record shape:

```json
{
  "version": 1,
  "kind": "lesson_proposal",
  "payload": {},
  "validator_id": "validator-sha256-...",
  "signature": "base64",
  "created_at": "..."
}
```

- [ ] **Step 5: Implement CLI**

Command:

```bash
barry-cache kb propose lesson \
  --title "..." \
  --problem "..." \
  --applies-when "a,b" \
  --recommendation "..." \
  --why "..." \
  --avoid-when "x,y" \
  --tags "agents,validation" \
  --confidence medium \
  [--dry-run] [--json]
```

Mode rules:

- `local-only`: reject proposal creation and dry-run; tell user to set `preview-only` or `share-enabled`.
- `preview-only`: allow dry-run and outbox creation.
- `share-enabled`: allow dry-run and outbox creation.

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/shared-kb-proposal.test.ts tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 5: Signed Validation Attestations

**Files:**
- Create: `src/core/shared-kb-attestation.ts`
- Modify: `src/core/shared-kb.ts`
- Create: `tests/shared-kb-attestation.test.ts`
- Modify: `tests/shared-kb.test.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing attestation tests**

Attestation schema:

```json
{
  "id": "attest-20260604-a8f3",
  "kind": "validation_attestation",
  "lesson_id": "lesson-20260604-a8f3",
  "validator_id": "validator-sha256-...",
  "result": "confirmed",
  "confidence": 0.82,
  "context_tags": ["typescript", "cli", "privacy"],
  "evidence_type": "observed_success",
  "upstream_seen": [],
  "created_at": "2026-06-04T16:00:00.000Z",
  "public_key": "base64-pem",
  "signature": "base64"
}
```

Allowed `result` values:

- `confirmed`
- `contradicted`
- `not_applicable`

Allowed `evidence_type` values:

- `observed_success`
- `observed_failure`
- `static_review`

Validation rules:

- `confidence` must be between `0.01` and `0.99`.
- `lesson_id` must match an existing lesson during source validation.
- Signature must verify against attestation payload excluding `signature`.
- `upstream_seen` must be an array of non-empty strings.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-attestation.test.ts tests/shared-kb.test.ts
```

Expected: FAIL because attestation support does not exist.

- [ ] **Step 3: Implement attestation validation**

Add `attestations/*.jsonl` loading to `validateSharedKbSource`.

Return extended result:

```ts
attestations: SharedKbAttestation[]
```

Keep old callers working by adding the new field without changing existing names.

- [ ] **Step 4: Implement `kb attest` CLI**

Command:

```bash
barry-cache kb attest \
  --lesson-id lesson-20260604-a8f3 \
  --result confirmed \
  --confidence 0.82 \
  --context-tags typescript,cli,privacy \
  --evidence-type observed_success \
  [--upstream-seen lesson-a,lesson-b] \
  [--dry-run] [--json]
```

Mode rules:

- `local-only`: reject.
- `preview-only`: allow preview and outbox.
- `share-enabled`: allow preview and outbox.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/shared-kb-attestation.test.ts tests/shared-kb.test.ts tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 6: Reputation And Lesson Scoring

**Files:**
- Create: `src/core/shared-kb-reputation.ts`
- Modify: `src/core/shared-kb.ts`
- Create: `tests/shared-kb-reputation.test.ts`
- Modify: `tests/shared-kb.test.ts`

- [ ] **Step 1: Write failing scoring tests**

Test cases:

- Confirmed observed success increases lesson score.
- Contradicted observed failure decreases lesson score.
- `static_review` has lower weight than observed outcomes.
- Attestations with `upstream_seen` containing the target lesson get a copied-evidence multiplier.
- New validators start with neutral reliability.

Expected formula for v1:

```ts
const evidenceWeights = {
  observed_success: 1.0,
  observed_failure: 1.2,
  static_review: 0.35,
};

const copiedMultiplier = upstreamSeen.includes(lessonId) ? 0.25 : 1;
const validatorReliability = priorOrComputedReliability;
const confidenceWeight = 0.5 + confidence;
const signedDirection = result === "confirmed" ? 1 : result === "contradicted" ? -1 : 0;
```

Lesson score:

```ts
score = sigmoid(sum(signedDirection * evidenceWeight * copiedMultiplier * validatorReliability * confidenceWeight))
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-reputation.test.ts
```

Expected: FAIL because scoring module does not exist.

- [ ] **Step 3: Implement scoring**

Output shape:

```json
{
  "version": 1,
  "generated_at": "...",
  "lessons": {
    "lesson-...": {
      "score": 0.82,
      "positive": 12,
      "negative": 2,
      "not_applicable": 1,
      "independent_sources": 5
    }
  },
  "validators": {
    "validator-sha256-...": {
      "reputation": 0.63,
      "attestations": 10
    }
  }
}
```

For v1, compute validator reputation from agreement with final lesson score after one aggregation pass. Do not add recursive EigenTrust-style iteration yet.

- [ ] **Step 4: Include reputation in snapshot build**

`kb build` writes:

```text
indexes/reputation.json
```

Manifest includes that file.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/shared-kb-reputation.test.ts tests/shared-kb.test.ts
```

Expected: PASS.

---

### Task 7: Daily Submission Batching

**Files:**
- Modify: `src/core/shared-kb-proposal.ts`
- Modify: `src/core/shared-kb-attestation.ts`
- Create: `src/core/shared-kb-batch.ts`
- Create: `tests/shared-kb-batch.test.ts`

- [ ] **Step 1: Write failing batch tests**

Expected behavior:

- `buildSharedKbSubmissionBatch({ repo, now })` reads every pending outbox item.
- It groups all pending lesson proposals into `lessons/community.jsonl`.
- It groups all pending attestations into `attestations/community.jsonl`.
- It produces one deterministic batch ID for a UTC day, shaped like `batch-20260604-<8 char hash>`.
- It excludes outbox items already marked as submitted in `.barry-cache/shared-kb/submissions.jsonl`.
- `canSubmitDailyBatch({ repo, now, submissionRepo })` returns `false` after a successful submission to the same target repo on the same UTC day.

Test sketch:

```ts
const batch = await buildSharedKbSubmissionBatch({
  repo,
  now: new Date("2026-06-04T16:00:00.000Z"),
});

expect(batch.id).toMatch(/^batch-20260604-[a-f0-9]{8}$/);
expect(batch.targets.map((target) => target.path)).toEqual([
  "attestations/community.jsonl",
  "lessons/community.jsonl",
]);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-batch.test.ts
```

Expected: FAIL because `shared-kb-batch.ts` does not exist.

- [ ] **Step 3: Implement batch builder**

Batch shape:

```ts
export interface SharedKbSubmissionBatch {
  id: string;
  created_at: string;
  outbox_items: string[];
  targets: Array<{
    path: "lessons/community.jsonl" | "attestations/community.jsonl";
    rows: string[];
  }>;
}
```

Submission state row:

```json
{
  "version": 1,
  "batch_id": "batch-20260604-a8f3c1d2",
  "submission_repo": "owner/barry-shared-kb",
  "status": "submitted",
  "submitted_at": "2026-06-04T16:00:00.000Z",
  "outbox_items": ["proposal-...", "attest-..."],
  "pr_url": "https://github.com/owner/barry-shared-kb/pull/123"
}
```

UTC daily key:

```ts
const day = now.toISOString().slice(0, 10).replaceAll("-", "");
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/shared-kb-batch.test.ts
```

Expected: PASS.

---

### Task 8: Submit Dry Run And Patch Bundle

**Files:**
- Modify: `src/core/shared-kb-batch.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing submit dry-run tests**

Expected behavior:

- `kb submit --dry-run` prints the daily batch ID, exact target JSONL file path, and row content for every pending outbox item.
- `preview-only` allows `--dry-run`.
- `local-only` rejects `--dry-run`.
- `share-enabled` allows `--dry-run`.
- `kb submit --dry-run` is allowed even if a batch was already submitted today because it does not create a PR.

Target paths:

- Lesson proposals: `lessons/community.jsonl`
- Attestations: `attestations/community.jsonl`

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/cli-kb.test.ts
```

Expected: FAIL because `kb submit` does not exist.

- [ ] **Step 3: Implement submit preview**

Add:

```bash
barry-cache kb submit --dry-run [--json]
```

Plain output includes:

```text
Shared KB submission preview
Batch: batch-20260604-a8f3c1d2
Target: lessons/community.jsonl
<json row>
Target: attestations/community.jsonl
<json row>
```

- [ ] **Step 4: Add patch bundle mode**

Command:

```bash
barry-cache kb submit --format patch --out .barry-cache/shared-kb/submission.patch
```

Mode rule:

- `share-enabled` required.
- Patch bundle mode uses the same daily batch content but does not mark the batch as submitted.
- Patch bundle mode does not consume the one-PR-per-day allowance because it does not create a GitHub PR.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 9: GitHub PR Submission Through `gh`

**Files:**
- Create: `src/core/shared-kb-git-submit.ts`
- Modify: `src/core/shared-kb-batch.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write tests using injected command runner**

Do not shell out directly in tests. Expose a function:

```ts
submitSharedKbViaGit(options: {
  repo: string;
  submissionRepo: string;
  batch: SharedKbSubmissionBatch;
  force?: boolean;
  run: (command: string[], cwd?: string) => Promise<{ code: number; stdout: string; stderr: string }>;
})
```

Test:

- It requires `owner/repo`.
- It refuses to submit if a successful submission already exists for the same `owner/repo` on the same UTC day.
- It allows same-day submission only when `force: true`.
- It creates a branch name `barry-shared-kb-YYYYMMDD-<hash>`.
- It calls `gh repo clone`, writes JSONL rows, commits, pushes, and opens PR.
- It returns PR URL from `gh pr create`.
- It appends a `submitted` row to `.barry-cache/shared-kb/submissions.jsonl` after PR creation succeeds.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/cli-kb.test.ts
```

Expected: FAIL because GitHub submission module does not exist.

- [ ] **Step 3: Implement GitHub submission**

Command:

```bash
barry-cache kb submit --repo owner/barry-shared-kb
barry-cache kb submit --repo owner/barry-shared-kb --force
```

Mode rule:

- Requires `share-enabled`.
- Without `--force`, Barry creates at most one submission PR per target repository per UTC day.

Error if `gh` is missing:

```text
GitHub submission requires the gh CLI. Run `barry-cache kb submit --format patch --out ...` for manual submission.
```

Do not store GitHub tokens. Rely on `gh auth status`.

Error if daily limit is hit:

```text
Shared KB submission already created for owner/barry-shared-kb today. Run `barry-cache kb submit --dry-run` to inspect pending items or pass `--force` to override.
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 10: Docs, ADR, And Source-Backed Facts

**Files:**
- Create: `docs/context/adrs/ADR-0009-use-signed-attestations-for-shared-kb-validation.md`
- Modify: `docs/shared-kb-cloudflare.md`
- Modify: `README.md`
- Modify: `docs/context/features/shared-kb/README.md`
- Modify: `docs/context/features/shared-kb/IDMAP.md`
- Modify: `docs/context/features/shared-kb/KG.adj`
- Modify: `docs/context/features/shared-kb/FACTS.jsonl`

- [ ] **Step 1: Create ADR**

Use:

```bash
bun run barry -- adr new --title "Use signed attestations for shared KB validation" --tags "shared-kb,attestations,reputation,privacy"
```

Fill the ADR with:

- Context: consensus alone proves agreement, not truth.
- Decision: use signed attestations, reputation scoring, Git PR moderation.
- Consequences: no automatic trusted status from vote count; copied evidence is discounted; maintainer review remains final trust gate.
- Operational limit: GitHub PR submission is batched and defaults to one submission PR per target repo per UTC day to avoid abuse/rate-limit risk.

- [ ] **Step 2: Update docs**

Document commands:

```bash
barry-cache kb recommend-query --task "Fix recurring validation failure"
barry-cache kb identity
barry-cache kb propose lesson ... --dry-run
barry-cache kb attest ... --dry-run
barry-cache kb submit --dry-run
barry-cache kb submit --format patch --out .barry-cache/shared-kb/submission.patch
barry-cache kb submit --repo owner/barry-shared-kb
barry-cache kb submit --repo owner/barry-shared-kb --force
```

Document the policy:

- Shared KB lookup is profitable when likely avoided reinvention cost exceeds lookup/context cost.
- Barry recommends lookup for debugging, validation, security/privacy, architecture, migration, unfamiliar API, recurring failure, and handoff-risk tasks.
- Barry does not recommend lookup for trivial rename, typo, formatting, label, or copy-only tasks.
- Query recommendations cap default KB results at 3 and shared KB context at 2,500 tokens.
- Barry stores proposal and attestation records locally until the user submits.
- `kb submit --dry-run` previews the daily batch.
- `kb submit --repo owner/repo` creates one PR containing all pending records.
- Barry refuses another PR to the same target on the same UTC day unless `--force` is passed.
- Maintainers should prefer daily batched PRs over one-record PRs.

- [ ] **Step 3: Update facts**

Add facts covering:

- `kb recommend-query` evaluates whether shared KB lookup is likely profitable before work.
- Shared KB query recommendations cap default results and context payload size.
- Signed validator identities live in `.barry-cache/shared-kb/identity.json`.
- Proposal and attestation outbox records are local until submission.
- Actual submission requires `share-enabled`.
- GitHub PR submission is batched and one-per-target-repo-per-UTC-day by default.
- Attestation scoring discounts copied evidence.
- Git PRs remain the moderation path.

- [ ] **Step 4: Validate context**

Run:

```bash
bun run barry -- validate
```

Expected: PASS.

---

### Task 11: Full Verification

**Files:**
- All touched files

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test tests/shared-kb-profitability.test.ts tests/shared-kb-identity.test.ts tests/shared-kb-proposal.test.ts tests/shared-kb-attestation.test.ts tests/shared-kb-batch.test.ts tests/shared-kb-reputation.test.ts tests/shared-kb.test.ts tests/cli-kb.test.ts tests/cli-help.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Validate Barry context**

Run:

```bash
bun run barry -- validate
```

Expected: PASS.

- [ ] **Step 5: Record handoff**

Run:

```bash
bun run barry -- finalize --status success --summary "Implemented high-profitability shared KB query policy, proposal, signed attestation, reputation scoring, daily batching, and Git PR submission workflow." --files "src/core/shared-kb-profitability.ts,src/core/shared-kb-identity.ts,src/core/shared-kb-proposal.ts,src/core/shared-kb-attestation.ts,src/core/shared-kb-batch.ts,src/core/shared-kb-reputation.ts,src/core/shared-kb.ts,src/cli.ts,docs/shared-kb-cloudflare.md" --tests "bun test,bun run typecheck,bun run barry -- validate"
```

Expected: handoff saved.

---

## Self-Review

- Spec coverage: The plan covers high-profitability query policy, top-k/context caps, submission preview, local outbox, daily batching, one-PR-per-target-repo-per-UTC-day submission guard, Git PR submission, signed identities, signed attestations, reputation scoring, copied-evidence discounting, docs, ADR, tests, and context validation.
- Placeholder scan: No `TBD` or unspecified implementation steps remain.
- Type consistency: The proposed modules use consistent names: `shared-kb-profitability`, `shared-kb-identity`, `shared-kb-proposal`, `shared-kb-attestation`, `shared-kb-batch`, `shared-kb-reputation`; CLI commands consistently use `kb recommend-query`, `kb propose`, `kb attest`, and `kb submit`.
