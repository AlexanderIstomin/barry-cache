# Shared KB Abuse-Resistant Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a next-version intake layer that protects the canonical shared KB GitHub repository from automated PR spam while preserving low-effort submissions for Barry instances.

**Architecture:** Keep the current MVP path as local outbox -> dry-run -> patch bundle or controlled daily PR. Add a separate Cloudflare-backed intake path for raw submissions, with rate limits, cheap validation, quarantine storage, maintainer batch export, and curated Git PR creation from accepted intake records.

**Tech Stack:** Bun, TypeScript, Cloudflare Workers, R2, Durable Objects or D1 for rate counters, JSONL, GitHub CLI or GitHub App for maintainer-side curated batch PRs, existing Barry shared KB schema/signature modules.

---

## Scope

This is a next-version plan. It should not replace the MVP submission plan at [2026-06-04-shared-kb-submissions-attestations.md](/home/a/Projects/barry-cache/docs/superpowers/plans/2026-06-04-shared-kb-submissions-attestations.md).

This plan exists because a public GitHub repo that accepts automated PRs can be abused. The safer architecture is:

```text
Barry instance -> signed local outbox -> Cloudflare intake -> quarantine R2 -> maintainer review/export -> curated Git PR -> canonical shared KB
```

GitHub remains the reviewed publication surface. Cloudflare becomes the raw intake buffer.

Do not implement tokens, payments, or blockchain in this version.

## File Structure

- Create `src/core/shared-kb-intake-client.ts`
  - Submits signed local batch payloads to a configured intake URL.
  - Retries conservatively and never loops after rate-limit responses.
  - Supports dry-run request rendering.

- Create `src/core/shared-kb-intake-schema.ts`
  - Defines intake request/response shapes.
  - Reuses shared KB proposal/attestation signature verification.
  - Exposes validation helpers used by both CLI and Worker tests.

- Create `workers/shared-kb-intake/src/index.ts`
  - Cloudflare Worker HTTP entrypoint.
  - Accepts `POST /v1/intake`.
  - Enforces cheap validation before R2 writes.
  - Writes accepted records into R2 quarantine.

- Create `workers/shared-kb-intake/src/rate-limit.ts`
  - Implements per-validator, per-IP, and global counters.
  - Uses Durable Object or D1 according to what is already available in the deployment.

- Create `workers/shared-kb-intake/src/storage.ts`
  - Writes quarantined JSON to R2 by date and validator.
  - Lists pending records for maintainer export.

- Create `workers/shared-kb-intake/wrangler.toml`
  - Declares Worker, R2 bucket, and rate-limit storage binding.

- Create `src/core/shared-kb-intake-export.ts`
  - Reads accepted/quarantined intake records from a local export or R2 mirror.
  - Produces Git-ready JSONL rows.
  - Creates one curated PR batch for maintainers.

- Modify `src/core/shared-kb-config.ts`
  - Add `shared_kb.remote.intake_url`.
  - Keep `submission_repo` optional for MVP Git PR path.

- Modify `src/cli.ts`
  - Add `kb submit --intake-url https://...`.
  - Add `kb submit --transport intake|patch|git`.
  - Add maintainer command `kb intake export`.

- Modify tests:
  - `tests/shared-kb-intake-schema.test.ts`
  - `tests/shared-kb-intake-client.test.ts`
  - `tests/shared-kb-intake-export.test.ts`
  - `tests/cli-kb.test.ts`
  - Worker tests under `workers/shared-kb-intake/tests/`

- Modify docs/context:
  - Create ADR: `docs/context/adrs/ADR-0010-use-cloudflare-intake-for-abuse-resistant-shared-kb-submissions.md`
  - Update `docs/shared-kb-cloudflare.md`
  - Update `docs/context/features/shared-kb/{README.md,IDMAP.md,KG.adj,FACTS.jsonl}`

---

### Task 1: Intake Config And Transport Selection

**Files:**
- Modify: `src/core/shared-kb-config.ts`
- Modify: `src/cli.ts`
- Modify: `tests/shared-kb-config.test.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing config tests**

Add:

```ts
test("stores an optional shared KB intake URL", async () => {
  await withTempRepo(async (repo) => {
    await writeSharedKbRemoteConfig({
      repo,
      remote: {
        intake_url: "https://intake.example.com/v1/intake",
      },
    });

    expect((await readSharedKbConfig({ repo })).shared_kb.remote).toEqual({
      intake_url: "https://intake.example.com/v1/intake",
    });
  });
});

test("rejects non-https intake URLs", async () => {
  await withTempRepo(async (repo) => {
    await expect(writeSharedKbRemoteConfig({
      repo,
      remote: { intake_url: "http://intake.example.com/v1/intake" },
    })).rejects.toThrow("intake_url must start with https://");
  });
});
```

- [ ] **Step 2: Write failing CLI transport tests**

Expected:

```bash
barry-cache kb submit --transport intake --dry-run
```

prints the configured `intake_url`.

Expected error:

```text
Shared KB intake transport requires shared_kb.remote.intake_url or --intake-url.
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-config.test.ts tests/cli-kb.test.ts
```

Expected: FAIL because intake config and transport do not exist.

- [ ] **Step 4: Implement config and CLI parsing**

Extend:

```ts
export interface SharedKbRemoteConfig {
  search_url?: string;
  submission_repo?: string;
  intake_url?: string;
}
```

CLI transport rules:

- `patch`: local patch bundle, no network.
- `git`: MVP GitHub PR flow.
- `intake`: POST to Cloudflare intake URL.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/shared-kb-config.test.ts tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 2: Intake Request Schema

**Files:**
- Create: `src/core/shared-kb-intake-schema.ts`
- Create: `tests/shared-kb-intake-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Request shape:

```json
{
  "version": 1,
  "kind": "shared_kb_intake_batch",
  "batch_id": "batch-20260604-a8f3c1d2",
  "validator_id": "validator-sha256-...",
  "created_at": "2026-06-04T18:00:00.000Z",
  "items": [
    {
      "target_path": "lessons/community.jsonl",
      "row": "{}"
    }
  ],
  "public_key": "base64-pem",
  "signature": "base64"
}
```

Tests:

- Valid signed request passes.
- Wrong signature fails.
- More than 50 items fails.
- Any row larger than 16 KB fails.
- Unknown target path fails.
- Private path/email/secret leakage fails by reusing shared KB validators.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-intake-schema.test.ts
```

Expected: FAIL because schema module does not exist.

- [ ] **Step 3: Implement schema validation**

Limits:

- Max 50 items per batch.
- Max 16 KB per JSONL row.
- Allowed targets:
  - `lessons/community.jsonl`
  - `attestations/community.jsonl`
- Required signature over request body excluding `signature`.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/shared-kb-intake-schema.test.ts
```

Expected: PASS.

---

### Task 3: Intake Client

**Files:**
- Create: `src/core/shared-kb-intake-client.ts`
- Create: `tests/shared-kb-intake-client.test.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing client tests**

Use an injected `fetch` implementation:

```ts
submitSharedKbIntakeBatch({
  intakeUrl: "https://intake.example.com/v1/intake",
  batch,
  fetch: async (url, init) => new Response(JSON.stringify({ ok: true, intake_id: "intake-1" })),
});
```

Expected:

- Sends one `POST`.
- Does not retry `429`.
- Returns retry hint from `Retry-After`.
- Fails clearly on `403`.
- Never logs private key.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-intake-client.test.ts tests/cli-kb.test.ts
```

Expected: FAIL because client module and CLI integration do not exist.

- [ ] **Step 3: Implement client and CLI**

Command:

```bash
barry-cache kb submit --transport intake
barry-cache kb submit --transport intake --intake-url https://intake.example.com/v1/intake
```

Mode rule:

- Requires `share-enabled`.
- Uses the existing daily batch.
- Records successful intake in `.barry-cache/shared-kb/submissions.jsonl` with `transport: "intake"`.

Rate-limit behavior:

- On `429`, do not retry automatically.
- Print:

```text
Shared KB intake rate limited. Retry after <seconds> seconds.
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/shared-kb-intake-client.test.ts tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 4: Cloudflare Worker Intake

**Files:**
- Create: `workers/shared-kb-intake/src/index.ts`
- Create: `workers/shared-kb-intake/src/rate-limit.ts`
- Create: `workers/shared-kb-intake/src/storage.ts`
- Create: `workers/shared-kb-intake/wrangler.toml`
- Create: `workers/shared-kb-intake/tests/intake.test.ts`

- [ ] **Step 1: Write failing Worker tests**

Test with Miniflare or the repo's preferred Worker test harness:

- `POST /v1/intake` accepts valid signed intake.
- Invalid signature returns `400`.
- Exceeding validator daily limit returns `429`.
- Exceeding IP hourly limit returns `429`.
- Accepted payload writes to R2 quarantine path:

```text
intake/2026/06/04/validator-sha256-.../batch-20260604-a8f3c1d2.json
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test workers/shared-kb-intake/tests/intake.test.ts
```

Expected: FAIL because Worker does not exist.

- [ ] **Step 3: Implement Worker**

Routes:

- `POST /v1/intake`
- `GET /healthz`

Validation order:

1. Reject non-POST for `/v1/intake`.
2. Reject body larger than 1 MB.
3. Validate JSON.
4. Validate signature/schema.
5. Check rate limits.
6. Write quarantine R2 object.

Recommended limits:

- Per validator: 5 batches/day.
- Per IP: 20 batches/hour.
- Global: 1,000 batches/day.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test workers/shared-kb-intake/tests/intake.test.ts
```

Expected: PASS.

---

### Task 5: Maintainer Intake Export

**Files:**
- Create: `src/core/shared-kb-intake-export.ts`
- Create: `tests/shared-kb-intake-export.test.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing export tests**

Expected:

```bash
barry-cache kb intake export --from ./intake-mirror --out ./shared-kb-export
```

produces:

```text
shared-kb-export/
  lessons/community.jsonl
  attestations/community.jsonl
  rejected.jsonl
```

Rules:

- Valid records are appended to target files.
- Invalid records are written to `rejected.jsonl` with reason.
- Duplicate batch IDs are ignored.
- Duplicate item IDs are ignored after first accepted row.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/shared-kb-intake-export.test.ts tests/cli-kb.test.ts
```

Expected: FAIL because export command does not exist.

- [ ] **Step 3: Implement export**

The command reads local files exported from R2. Do not require live Cloudflare access in this task.

Command:

```bash
barry-cache kb intake export --from /path/to/r2-export --out shared-kb
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/shared-kb-intake-export.test.ts tests/cli-kb.test.ts
```

Expected: PASS.

---

### Task 6: Curated Git Batch PR

**Files:**
- Modify: `src/core/shared-kb-intake-export.ts`
- Modify: `src/core/shared-kb-git-submit.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli-kb.test.ts`

- [ ] **Step 1: Write failing curated PR tests**

Expected command:

```bash
barry-cache kb intake export --from ./intake-mirror --out ./shared-kb-export --pr owner/barry-shared-kb
```

Expected behavior:

- Creates one maintainer-side branch `barry-intake-export-YYYYMMDD-<hash>`.
- Commits exported accepted JSONL rows.
- Opens one PR.
- Does not include rejected records.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/cli-kb.test.ts tests/shared-kb-intake-export.test.ts
```

Expected: FAIL because export-to-PR does not exist.

- [ ] **Step 3: Implement curated PR command**

This command is for maintainers or trusted automation. It can use the same injected command runner pattern as MVP Git submission tests.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/cli-kb.test.ts tests/shared-kb-intake-export.test.ts
```

Expected: PASS.

---

### Task 7: Docs, ADR, And Operations

**Files:**
- Create: `docs/context/adrs/ADR-0010-use-cloudflare-intake-for-abuse-resistant-shared-kb-submissions.md`
- Modify: `docs/shared-kb-cloudflare.md`
- Modify: `docs/context/features/shared-kb/README.md`
- Modify: `docs/context/features/shared-kb/IDMAP.md`
- Modify: `docs/context/features/shared-kb/KG.adj`
- Modify: `docs/context/features/shared-kb/FACTS.jsonl`

- [ ] **Step 1: Create ADR**

Use:

```bash
bun run barry -- adr new --title "Use Cloudflare intake for abuse-resistant shared KB submissions" --tags "shared-kb,cloudflare,abuse,submissions"
```

ADR points:

- GitHub PRs are reviewed publication, not raw ingestion.
- Cloudflare intake absorbs spam/rate-limit pressure.
- R2 quarantine keeps raw submissions separate from canonical KB.
- Maintainers export curated batches into Git.

- [ ] **Step 2: Document deployment**

Add Cloudflare setup:

```bash
cd workers/shared-kb-intake
npx wrangler r2 bucket create barry-shared-kb-intake
npx wrangler deploy
```

Document recommended limits:

- 5 batches/day per validator.
- 20 batches/hour per IP.
- 1,000 batches/day global.
- Emergency kill switch: set Worker env `INTAKE_DISABLED=true`.

- [ ] **Step 3: Document user flow**

Barry instance:

```bash
barry-cache kb sharing set share-enabled
barry-cache kb submit --transport intake --intake-url https://intake.example.com/v1/intake
```

Maintainer:

```bash
barry-cache kb intake export --from ./r2-export --out ./shared-kb-export
barry-cache kb validate --source ./shared-kb-export
barry-cache kb intake export --from ./r2-export --out ./shared-kb-export --pr owner/barry-shared-kb
```

- [ ] **Step 4: Update facts**

Add facts:

- Raw shared KB intake uses Cloudflare Worker and R2 quarantine.
- Canonical GitHub repo receives curated batch PRs, not raw public PR spam.
- Worker rate limits protect by validator, IP, and global counters.
- Maintainers can disable intake with `INTAKE_DISABLED`.

- [ ] **Step 5: Validate context**

Run:

```bash
bun run barry -- validate
```

Expected: PASS.

---

### Task 8: Full Verification

**Files:**
- All touched files

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test tests/shared-kb-intake-schema.test.ts tests/shared-kb-intake-client.test.ts tests/shared-kb-intake-export.test.ts tests/cli-kb.test.ts workers/shared-kb-intake/tests/intake.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full repo tests**

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
bun run barry -- finalize --status success --summary "Implemented next-version abuse-resistant shared KB intake with Cloudflare Worker, R2 quarantine, rate limits, and curated Git batch export." --files "src/core/shared-kb-intake-client.ts,src/core/shared-kb-intake-schema.ts,src/core/shared-kb-intake-export.ts,workers/shared-kb-intake/src/index.ts,docs/shared-kb-cloudflare.md" --tests "bun test,bun run typecheck,bun run barry -- validate"
```

Expected: handoff saved.

---

## Self-Review

- Spec coverage: The plan covers GitHub abuse risk by moving raw intake to Cloudflare, validating signatures cheaply, rate-limiting by validator/IP/global counters, storing quarantine records in R2, exporting curated batches, and opening maintainer-side Git PRs.
- Placeholder scan: No placeholder tasks remain; every task has concrete paths, commands, and expected outputs.
- Type consistency: The plan consistently uses `shared-kb-intake-client`, `shared-kb-intake-schema`, `shared-kb-intake-export`, and Worker paths under `workers/shared-kb-intake`.

