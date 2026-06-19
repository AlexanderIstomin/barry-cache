# cq Contribute Adapter (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Contribute queued Barry lessons to cq — `barry-cache kb contribute` maps each outbox lesson to cq's `propose.json` shape and POSTs it to `POST /api/v1/knowledge`, embedding provenance as prose, gated on `share-enabled`.

**Architecture:** Extend the versioned `src/core/cq-adapter.ts` with the *contribute* direction: `lessonToCqProposal` (Barry lesson → cq propose request) + `cqContribute` (single-object POST with injectable fetch). A new `kb contribute` CLI subcommand reads the cq descriptor + the existing outbox and posts each lesson, with `--dry-run`. Barry's lesson format stays canonical; nothing in the Brain/`kb submit` path is touched (that's Phase 3).

**Tech Stack:** TypeScript ESM, Bun test, Node ≥20 `fetch`. No new deps.

## Global Constraints

- Node `>=20`; ESM; no new runtime dependencies.
- **cq contract (authoritative, from `schema/propose.json`):** a contribution is a SINGLE object `{ domains: string[] (minItems 1), insight: {summary, detail, action}, context?: {languages?, frameworks?, pattern?}, created_by? }`. No `id` (server-assigned), no `evidence`, **no signature** — so signing is NOT part of this path; provenance rides as prose in `insight.detail` + `created_by`. There is **no batch** endpoint and **no REST attest** (confirm/flag are MCP-only) — out of scope.
- Reuse `SharedKbLesson`, `listOutboxLessons` (`shared-kb-proposal.ts`), `loadOrCreateValidatorIdentity` (`shared-kb-identity.ts`), `readSharedKbConfig`/`SharedKbCqConfig`, and the existing `resolveCqApiKey` in `cli.ts`.
- Tests use `bun:test` + `withTempRepo`; CLI tests reuse `runCli(repo, args)` / `proposeArgs` already in `tests/cli-kb.test.ts`.

---

### Task 1: `lessonToCqProposal` + provenance note

**Files:** Modify `src/core/cq-adapter.ts`; Test `tests/cq-adapter.test.ts`.

**Interfaces:**
- Consumes: `SharedKbLesson` from `./shared-kb`; `CqContext` (already in adapter).
- Produces: `export interface CqProposeRequest { domains: string[]; insight: { summary: string; detail: string; action: string }; context?: CqContext; created_by?: string }`; `export function buildProvenanceNote(lesson: SharedKbLesson): string`; `export function lessonToCqProposal(lesson: SharedKbLesson, opts?: { createdBy?: string }): CqProposeRequest`.

- [ ] **Step 1: Failing test** (append to `tests/cq-adapter.test.ts`; add `lessonToCqProposal, buildProvenanceNote` to the import)

```typescript
import type { SharedKbLesson } from "../src/core/shared-kb";

function sampleLesson(overrides: Partial<SharedKbLesson> = {}): SharedKbLesson {
  return {
    id: "lesson-20260619-abcd1234",
    kind: "lesson",
    status: "submitted",
    title: "Validate handoffs before trusting them",
    problem: "Agents trust stale handoff summaries.",
    applies_when: ["multi-agent workflow"],
    recommendation: "Validate claims before treating them as durable context.",
    why: "Stale operational memory becomes false canonical truth.",
    avoid_when: ["the source cannot be anonymized"],
    confidence: "medium",
    evidence: { source_type: "community_report", count: 2, has_follow_up_fix: true },
    tags: ["agents", "validation"],
    updated_at: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("lessonToCqProposal", () => {
  test("maps a lesson to cq propose shape with provenance in detail", () => {
    const req = lessonToCqProposal(sampleLesson(), { createdBy: "validator-xyz" });
    expect(req.domains).toEqual(["agents", "validation"]);
    expect(req.insight.summary).toBe("Validate handoffs before trusting them");
    expect(req.insight.action).toBe("Validate claims before treating them as durable context.");
    expect(req.insight.detail).toContain("Agents trust stale handoff summaries.");
    expect(req.insight.detail).toContain("Source: Barry Cache lesson lesson-20260619-abcd1234");
    expect(req.context?.pattern).toContain("applies when: multi-agent workflow");
    expect(req.context?.pattern).toContain("avoid when: the source cannot be anonymized");
    expect(req.created_by).toBe("validator-xyz");
  });

  test("throws when the lesson has no tags (cq requires >=1 domain)", () => {
    expect(() => lessonToCqProposal(sampleLesson({ tags: [] }))).toThrow("at least one domain");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `bun test tests/cq-adapter.test.ts` (export not found).

- [ ] **Step 3: Implement** (in `src/core/cq-adapter.ts`; add `SharedKbLesson` to the `import type ... from "./shared-kb"` line)

```typescript
export interface CqProposeRequest {
  domains: string[];
  insight: { summary: string; detail: string; action: string };
  context?: CqContext;
  created_by?: string;
}

export function buildProvenanceNote(lesson: SharedKbLesson): string {
  const fix = lesson.evidence.has_follow_up_fix ? ", has follow-up fix" : "";
  return `Source: Barry Cache lesson ${lesson.id} (${lesson.evidence.source_type}, ${lesson.evidence.count} observation(s)${fix}).`;
}

export function lessonToCqProposal(lesson: SharedKbLesson, opts: { createdBy?: string } = {}): CqProposeRequest {
  if (!lesson.tags || lesson.tags.length === 0) {
    throw new Error("cq propose requires at least one domain; lesson has no tags");
  }
  const detail = [lesson.problem, lesson.why, buildProvenanceNote(lesson)].filter(Boolean).join("\n\n");
  const patternParts: string[] = [];
  if (lesson.applies_when.length > 0) patternParts.push(`applies when: ${lesson.applies_when.join("; ")}`);
  if (lesson.avoid_when.length > 0) patternParts.push(`avoid when: ${lesson.avoid_when.join("; ")}`);
  const request: CqProposeRequest = {
    domains: lesson.tags,
    insight: { summary: lesson.title, detail, action: lesson.recommendation },
  };
  if (patternParts.length > 0) request.context = { pattern: patternParts.join(" | ") };
  if (opts.createdBy) request.created_by = opts.createdBy;
  return request;
}
```

- [ ] **Step 4: Run — expect PASS** `bun test tests/cq-adapter.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "feat(cq): map Barry lessons to cq propose requests"`.

---

### Task 2: `cqContribute` (single-object POST)

**Files:** Modify `src/core/cq-adapter.ts`; Test `tests/cq-adapter.test.ts`.

**Interfaces:**
- Consumes: `CqProposeRequest` (Task 1).
- Produces: `export async function cqContribute(options: { endpoint: string; proposal: CqProposeRequest; apiKey?: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; status: number; id?: string; error?: string }>`.

- [ ] **Step 1: Failing test** (append; add `cqContribute` to import)

```typescript
describe("cqContribute", () => {
  test("POSTs the proposal and returns the assigned id", async () => {
    let captured: { method?: string; body?: unknown; auth?: string | null } = {};
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      captured = { method: init?.method, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ data: { id: "ku_" + "a".repeat(32) } }), { status: 201 });
    }) as typeof fetch;
    const res = await cqContribute({
      endpoint: "https://cq.example.com/",
      proposal: { domains: ["ci"], insight: { summary: "s", detail: "d", action: "a" } },
      apiKey: "secret",
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    expect(res.id).toBe("ku_" + "a".repeat(32));
    expect(captured.method).toBe("POST");
    expect(captured.auth).toBe("Bearer secret");
    expect((captured.body as { domains: string[] }).domains).toEqual(["ci"]);
  });

  test("returns ok:false with the error body on non-2xx", async () => {
    const fetchImpl = (async () => new Response("bad domains", { status: 422 })) as unknown as typeof fetch;
    const res = await cqContribute({ endpoint: "https://cq.example.com", proposal: { domains: ["x"], insight: { summary: "s", detail: "d", action: "a" } }, fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toContain("bad domains");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cqContribute` not exported).

- [ ] **Step 3: Implement**

```typescript
export async function cqContribute(options: {
  endpoint: string;
  proposal: CqProposeRequest;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; id?: string; error?: string }> {
  const url = `${options.endpoint.replace(/\/+$/, "")}/api/v1/knowledge`;
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, { method: "POST", headers, body: JSON.stringify(options.proposal) });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, error: text || response.statusText };
  try {
    const parsed = JSON.parse(text) as { data?: { id?: unknown } };
    if (typeof parsed.data?.id === "string") return { ok: true, status: response.status, id: parsed.data.id };
  } catch { /* empty/non-JSON body is acceptable */ }
  return { ok: true, status: response.status };
}
```

- [ ] **Step 4: Run — expect PASS**.
- [ ] **Step 5: Commit** `git commit -m "feat(cq): cqContribute POSTs a proposal to cq /api/v1/knowledge"`.

---

### Task 3: `kb contribute` CLI subcommand

**Files:** Modify `src/cli.ts`; Test `tests/cli-kb.test.ts`.

**Interfaces:**
- Consumes: `lessonToCqProposal`, `cqContribute` (cq-adapter); `listOutboxLessons`, `loadOrCreateValidatorIdentity`, `readSharedKbConfig`, `resolveCqApiKey` (existing).
- Produces: `kb contribute [--dry-run] [--json]` — gated `share_enabled`; reads `shared_kb.cq`; maps + POSTs each outbox lesson; `created_by` = validator id.

- [ ] **Step 1: Failing test** (append to `tests/cli-kb.test.ts`)

```typescript
describe("kb contribute", () => {
  test("maps queued lessons to cq propose requests and POSTs them", async () => {
    await withTempRepo(async (repo) => {
      const received: any[] = [];
      const server = Bun.serve({
        port: 0,
        fetch: async (req) => { received.push(await req.json()); return new Response(JSON.stringify({ data: { id: "ku_" + "a".repeat(32) } }), { status: 201 }); },
      });
      try {
        await mkdir(join(repo, ".barry-cache"), { recursive: true });
        await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({
          shared_kb: { contribution: "share_enabled", cq: { url: `http://127.0.0.1:${server.port}` } },
        }));
        expect((await runCli(repo, proposeArgs)).code).toBe(0); // queue one lesson to the outbox
        const result = await runCli(repo, ["kb", "contribute", "--json"]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).contributed).toBe(1);
        expect(received[0].insight.summary).toBe("Treat handoffs as claims until validated");
        expect(received[0].domains).toEqual(["agents", "validation"]);
        expect(received[0].insight.detail).toContain("Source: Barry Cache lesson");
      } finally { server.stop(true); }
    });
  });

  test("requires share-enabled mode", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, ".barry-cache"), { recursive: true });
      await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({ shared_kb: { contribution: "preview_only", cq: { url: "https://cq.example.com" } } }));
      const result = await runCli(repo, ["kb", "contribute"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("share-enabled");
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Unknown KB action: contribute`).

- [ ] **Step 3: Implement** (in `src/cli.ts`)

Add imports: `import { cqSearch, cqContribute, lessonToCqProposal } from "./core/cq-adapter";` (extend the existing cq-adapter import).

Add to `handleKbCommand` before the final throw:
```typescript
  if (action === "contribute") {
    await handleKbContributeCommand(parsed, repo, json);
    return;
  }
```

Add the handler near `handleKbSubmitCommand`:
```typescript
async function handleKbContributeCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution !== "share_enabled") {
    throw new CliArgumentError("cq contribute requires share-enabled mode. Run `barry-cache kb sharing set share-enabled`.", {
      usage: commandUsage("kb sharing set"),
      options: { mode: [...sharedKbContributionModes] },
    });
  }
  const cq = config.shared_kb.cq;
  if (!cq) {
    throw new CliArgumentError("No cq endpoint configured. Set shared_kb.cq.url in .barry-cache/config.json.", { usage: commandUsage("kb contribute") });
  }
  const lessons = await listOutboxLessons({ repo });
  if (lessons.length === 0) {
    print({ contributed: 0, results: [] }, json, "No pending shared KB proposals to contribute.");
    return;
  }
  const identity = await loadOrCreateValidatorIdentity({ repo, now: new Date().toISOString() });
  const proposals = lessons.map((lesson) => ({ lesson, proposal: lessonToCqProposal(lesson, { createdBy: identity.validator_id }) }));

  if (parsed.flags.get("dry-run") === true) {
    print({ cq: cq.url, proposals: proposals.map((p) => p.proposal) }, json, `Dry run — would contribute ${proposals.length} lesson(s) to ${cq.url}/api/v1/knowledge.`);
    return;
  }
  const apiKey = resolveCqApiKey(cq);
  const results: Array<{ lesson: string; ok: boolean; status: number; id?: string; error?: string }> = [];
  for (const { lesson, proposal } of proposals) {
    const contributeOptions: Parameters<typeof cqContribute>[0] = { endpoint: cq.url, proposal };
    if (apiKey) contributeOptions.apiKey = apiKey;
    const res = await cqContribute(contributeOptions);
    results.push({ lesson: lesson.id, ...res });
  }
  const ok = results.filter((r) => r.ok).length;
  if (ok < results.length) process.exitCode = 1;
  print({ contributed: ok, results }, json, `Contributed ${ok}/${results.length} lesson(s) to ${cq.url}.`);
}
```

Add a usage entry to `commandUsage`: `"kb contribute": "barry-cache kb contribute [--dry-run] [--json]",` and extend the `kb` usage line to include `contribute`.

- [ ] **Step 4: Run — expect PASS** `bun test tests/cli-kb.test.ts`, then full `bun test`, then `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(cq): kb contribute posts queued lessons to cq"`.

---

### Task 4: Record facts + validate

**Files:** Modify `docs/context/features/shared-kb/FACTS.jsonl`, `docs/context/features/shared-kb/IDMAP.md`.

- [ ] **Step 1:** Add an `implemented` fact (real ISO timestamp via `date -u +%Y-%m-%dT%H:%M:%S.000Z`):

```jsonl
{"id":"SKB-<ISO-COMPACT>-cq03","subject":"barry-cache kb contribute","predicate":"posts","object":"each queued outbox lesson to cq POST /api/v1/knowledge as a propose request (domains<-tags, insight summary/detail/action, provenance prose + created_by=validator id), gated on share-enabled, with --dry-run; cq propose carries no signature/evidence","src":["CQ_ADAPTER","CLI","CQ_ADAPTER_TEST","CLI_KB_TEST","CQ_INTEROP_ADR"],"status":"active","kind":"implemented","updated_at":"<ISO>","confidence":"high","tags":["shared-kb","cq","interop","contribute"]}
```

- [ ] **Step 2: Validate** `bun run barry -- validate` → `Barry Cache context is valid.`
- [ ] **Step 3: Commit** `git commit -m "docs(shared-kb): record cq contribute adapter fact"`.

---

## Self-Review

- **Scope vs ADR-0011 §Decision:** contribute via propose with provenance-as-prose + `created_by` ✅; signing NOT on cq path ✅ (no signature field touched); attest NOT sent to cq ✅ (no REST endpoint — documented out-of-scope). Brain/`kb submit` untouched (Phase 3) ✅.
- **Placeholders:** only the `<ISO>` timestamp in Task 4 (generated at write time). All code complete.
- **Type consistency:** `CqProposeRequest` defined Task 1, consumed Tasks 2–3; `cqContribute` return shape `{ok,status,id?,error?}` consumed in CLI results; `resolveCqApiKey`/`listOutboxLessons`/`loadOrCreateValidatorIdentity`/`readSharedKbConfig` already exist with the used signatures.

## Out of scope

Attestation to cq (no REST endpoint; confirm/flag are MCP-only), Ed25519 signing on the cq path (no field), batch contribute (cq propose is single-object), and `brain/` retirement (Phase 3).
