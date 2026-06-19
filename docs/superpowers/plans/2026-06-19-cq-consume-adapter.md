# cq Consume Adapter (Phase 1) Implementation Plan

> **Status:** Implemented (historical plan). Records the Phase 1 plan as written; the shipped state is authoritative in the ADRs and `docs/context/features/shared-kb/FACTS.jsonl`. Notably the `brain` config referenced below was later removed (cq-only) — see ADR-0011/ADR-0014.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Barry read Mozilla cq's shared knowledge — `barry-cache kb search --source cq --query "..."` returns cq knowledge units mapped to Barry search items through a versioned, fixture-tested adapter, with zero change to existing behavior.

**Architecture:** A new pure module `src/core/cq-adapter.ts` owns the cq contract: parse cq's `data`-rooted `KnowledgeUnitList`, map each `knowledge_unit` to the existing `SharedKbSearchItem` shape, and run the same token scoring as local search. Network access is injected (`fetchImpl`) so everything is fixture-tested. The CLI gains a `--source cq` branch that reads a cq endpoint descriptor from `.barry-cache/config.json` and reuses the existing result formatter. Barry's format stays canonical; cq is reached only through this adapter (the ADR-0011 hedge).

**Tech Stack:** TypeScript (ESM), Bun test runner (`bun test`), Node ≥20 global `fetch`. No new runtime dependencies.

## Global Constraints

- Node `>=20`; ESM (`"type": "module"`). One line each, copied from `package.json`.
- No new runtime dependencies (repo ships only `serve-handler`). The adapter uses global `fetch` and `node:` built-ins only.
- Pin the cq contract behind `CQ_SCHEMA_VERSION` — never couple core modules to cq types beyond this adapter.
- Tests use `import { describe, expect, test } from "bun:test";` and the `withTempRepo` helper from `tests/helpers.ts`.
- Reuse existing exports from `src/core/shared-kb.ts` (`tokens`, `scoreText`, `SharedKbSearchItem`, `SharedKbSearchResult`, `SharedKbKind`, `SharedKbStatus`, `SharedKbConfidence`) — do not duplicate scoring or types.

---

### Task 1: cq response types + `parseKnowledgeUnitList`

**Files:**
- Create: `src/core/cq-adapter.ts`
- Test: `tests/cq-adapter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const CQ_SCHEMA_VERSION = "v1"`
  - `export interface CqInsight { summary?: string; detail?: string; action?: string }`
  - `export interface CqKnowledgeUnit { id: string; version?: number | string; domain?: string[]; insight?: CqInsight; language?: string; frameworks?: string[]; environment?: string; pattern?: string; severity?: string; confidence?: number; confirmations?: number; contributing_orgs?: number; status?: string; kind?: string; first_observed?: string; last_confirmed?: string }`
  - `export interface CqKnowledgeUnitList { units: CqKnowledgeUnit[]; nextCursor: string | null }`
  - `export function parseKnowledgeUnitList(json: unknown): CqKnowledgeUnitList`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cq-adapter.test.ts
import { describe, expect, test } from "bun:test";
import { parseKnowledgeUnitList } from "../src/core/cq-adapter";

describe("parseKnowledgeUnitList", () => {
  test("unwraps the data array and reads next_cursor", () => {
    const parsed = parseKnowledgeUnitList({
      data: [{ id: "ku_1", insight: { summary: "x" } }],
      next_cursor: "abc",
    });
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0]?.id).toBe("ku_1");
    expect(parsed.nextCursor).toBe("abc");
  });

  test("defaults next_cursor to null for an unpaginated list", () => {
    const parsed = parseKnowledgeUnitList({ data: [] });
    expect(parsed.units).toEqual([]);
    expect(parsed.nextCursor).toBeNull();
  });

  test("throws when data is missing or malformed", () => {
    expect(() => parseKnowledgeUnitList({})).toThrow("cq response missing data array");
    expect(() => parseKnowledgeUnitList({ data: [{ insight: {} }] })).toThrow("cq knowledge unit missing id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cq-adapter.test.ts`
Expected: FAIL — `Cannot find module "../src/core/cq-adapter"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/cq-adapter.ts
export const CQ_SCHEMA_VERSION = "v1";

export interface CqInsight {
  summary?: string;
  detail?: string;
  action?: string;
}

export interface CqKnowledgeUnit {
  id: string;
  version?: number | string;
  domain?: string[];
  insight?: CqInsight;
  language?: string;
  frameworks?: string[];
  environment?: string;
  pattern?: string;
  severity?: string;
  confidence?: number;
  confirmations?: number;
  contributing_orgs?: number;
  status?: string;
  kind?: string;
  first_observed?: string;
  last_confirmed?: string;
}

export interface CqKnowledgeUnitList {
  units: CqKnowledgeUnit[];
  nextCursor: string | null;
}

export function parseKnowledgeUnitList(json: unknown): CqKnowledgeUnitList {
  if (typeof json !== "object" || json === null) throw new Error("cq response missing data array");
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("cq response missing data array");
  const units: CqKnowledgeUnit[] = data.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("cq knowledge unit missing id");
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) throw new Error("cq knowledge unit missing id");
    return entry as CqKnowledgeUnit;
  });
  const cursor = (json as { next_cursor?: unknown }).next_cursor;
  return { units, nextCursor: typeof cursor === "string" ? cursor : null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cq-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/cq-adapter.ts tests/cq-adapter.test.ts
git commit -m "feat(cq): parse cq KnowledgeUnitList responses"
```

---

### Task 2: Map a cq unit to a Barry search item

**Files:**
- Modify: `src/core/cq-adapter.ts`
- Test: `tests/cq-adapter.test.ts`

**Interfaces:**
- Consumes: `CqKnowledgeUnit` (Task 1); `SharedKbSearchItem`, `SharedKbKind`, `SharedKbStatus`, `SharedKbConfidence` from `src/core/shared-kb.ts`.
- Produces: `export function cqUnitToSearchItem(unit: CqKnowledgeUnit): SharedKbSearchItem`

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/cq-adapter.test.ts
import { cqUnitToSearchItem } from "../src/core/cq-adapter";

describe("cqUnitToSearchItem", () => {
  test("maps insight, kind, confidence band, and status", () => {
    const item = cqUnitToSearchItem({
      id: "ku_42",
      kind: "pitfall",
      confidence: 0.7,
      domain: ["testing", "ci"],
      insight: { summary: "Flaky retries", detail: "Tests retry under load", action: "Pin the seed" },
      last_confirmed: "2026-06-01T00:00:00.000Z",
    });
    expect(item.id).toBe("ku_42");
    expect(item.kind).toBe("anti_pattern"); // pitfall -> anti_pattern
    expect(item.status).toBe("trusted"); // confidence >= 0.6
    expect(item.confidence).toBe("high"); // >= 0.66
    expect(item.title).toBe("Flaky retries");
    expect(item.summary).toBe("Tests retry under load Pin the seed");
    expect(item.tags).toEqual(["testing", "ci"]);
    expect(item.updated_at).toBe("2026-06-01T00:00:00.000Z");
    expect(item.text).toContain("flaky retries");
  });

  test("defaults unknown kind to lesson and low confidence to reviewed/low", () => {
    const item = cqUnitToSearchItem({ id: "ku_1", confidence: 0.1, insight: { summary: "s" } });
    expect(item.kind).toBe("lesson");
    expect(item.status).toBe("reviewed");
    expect(item.confidence).toBe("low");
    expect(item.title).toBe("s");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cq-adapter.test.ts`
Expected: FAIL — `cqUnitToSearchItem is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// add imports at top of src/core/cq-adapter.ts
import type { SharedKbConfidence, SharedKbKind, SharedKbSearchItem, SharedKbStatus } from "./shared-kb";

// add to src/core/cq-adapter.ts
function cqKindToBarryKind(kind?: string): SharedKbKind {
  if (kind === "pitfall") return "anti_pattern";
  if (kind === "tool-recommendation") return "decision_pattern";
  return "lesson";
}

function cqConfidenceToBand(confidence?: number): SharedKbConfidence {
  const value = typeof confidence === "number" ? confidence : 0;
  if (value >= 0.66) return "high";
  if (value >= 0.33) return "medium";
  return "low";
}

function cqConfidenceToStatus(confidence?: number): SharedKbStatus {
  return typeof confidence === "number" && confidence >= 0.6 ? "trusted" : "reviewed";
}

export function cqUnitToSearchItem(unit: CqKnowledgeUnit): SharedKbSearchItem {
  const insight = unit.insight ?? {};
  const title = insight.summary ?? unit.id;
  const summary = [insight.detail, insight.action].filter(Boolean).join(" ").trim();
  const tags = Array.isArray(unit.domain) ? unit.domain : [];
  const kind = cqKindToBarryKind(unit.kind);
  const status = cqConfidenceToStatus(unit.confidence);
  const confidence = cqConfidenceToBand(unit.confidence);
  return {
    id: unit.id,
    kind,
    status,
    title,
    summary,
    tags,
    confidence,
    updated_at: unit.last_confirmed ?? unit.first_observed ?? "",
    text: [
      unit.id,
      kind,
      status,
      title,
      summary,
      tags.join(" "),
      insight.summary ?? "",
      insight.detail ?? "",
      insight.action ?? "",
      unit.language ?? "",
      (unit.frameworks ?? []).join(" "),
      unit.pattern ?? "",
    ].join(" ").toLowerCase(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cq-adapter.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/core/cq-adapter.ts tests/cq-adapter.test.ts
git commit -m "feat(cq): map cq knowledge units to Barry search items"
```

---

### Task 3: `cqSearch` — fetch, parse, map, score

**Files:**
- Modify: `src/core/cq-adapter.ts`
- Test: `tests/cq-adapter.test.ts`

**Interfaces:**
- Consumes: `parseKnowledgeUnitList`, `cqUnitToSearchItem` (Tasks 1–2); `tokens`, `scoreText`, `SharedKbSearchResult` from `src/core/shared-kb.ts`.
- Produces: `export async function cqSearch(options: { endpoint: string; query: string; domains?: string[]; apiKey?: string; fetchImpl?: typeof fetch }): Promise<SharedKbSearchResult>`. Matches all query tokens (parity with `searchSharedKb`); sorts by score desc, then confidence, then id.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/cq-adapter.test.ts
import { cqSearch } from "../src/core/cq-adapter";

function fakeFetch(body: unknown, captured: { url?: string; auth?: string | null }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    captured.url = String(input);
    captured.auth = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("cqSearch", () => {
  test("returns only units matching all query tokens, scored and sorted", async () => {
    const captured: { url?: string; auth?: string | null } = {};
    const body = {
      data: [
        { id: "ku_hit", confidence: 0.8, insight: { summary: "retry storms", detail: "ci flaky tests", action: "pin" } },
        { id: "ku_miss", confidence: 0.9, insight: { summary: "unrelated", detail: "database", action: "index" } },
      ],
    };
    const result = await cqSearch({
      endpoint: "https://cq.example.com",
      query: "flaky tests",
      apiKey: "secret",
      fetchImpl: fakeFetch(body, captured),
    });
    expect(result.results.map((r) => r.id)).toEqual(["ku_hit"]);
    expect(result.results[0]?.score).toBe(2);
    expect(captured.url).toBe("https://cq.example.com/api/v1/knowledge");
    expect(captured.auth).toBe("Bearer secret");
  });

  test("passes domains as a query parameter", async () => {
    const captured: { url?: string; auth?: string | null } = {};
    await cqSearch({
      endpoint: "https://cq.example.com/",
      query: "x",
      domains: ["testing", "ci"],
      fetchImpl: fakeFetch({ data: [] }, captured),
    });
    expect(captured.url).toBe("https://cq.example.com/api/v1/knowledge?domains=testing%2Cci");
    expect(captured.auth).toBeNull();
  });

  test("throws on a non-OK response", async () => {
    const failing = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    await expect(
      cqSearch({ endpoint: "https://cq.example.com", query: "x", fetchImpl: failing }),
    ).rejects.toThrow("cq search failed: 503");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cq-adapter.test.ts`
Expected: FAIL — `cqSearch is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extend the shared-kb import at the top of src/core/cq-adapter.ts to add values + type:
import { scoreText, tokens } from "./shared-kb";
import type { SharedKbConfidence, SharedKbKind, SharedKbSearchItem, SharedKbSearchResult, SharedKbStatus } from "./shared-kb";

// add to src/core/cq-adapter.ts
export async function cqSearch(options: {
  endpoint: string;
  query: string;
  domains?: string[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<SharedKbSearchResult> {
  const base = options.endpoint.replace(/\/+$/, "");
  const suffix = options.domains && options.domains.length > 0
    ? `?domains=${encodeURIComponent(options.domains.join(","))}`
    : "";
  const url = `${base}/api/v1/knowledge${suffix}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, { headers });
  if (!response.ok) throw new Error(`cq search failed: ${response.status} ${response.statusText}`);
  const { units } = parseKnowledgeUnitList(JSON.parse(await response.text()));
  const queryTokens = tokens(options.query);
  const results = units
    .map((unit) => cqUnitToSearchItem(unit))
    .map((item) => ({ ...item, score: scoreText(item.text, queryTokens) }))
    .filter((item) => item.score === queryTokens.length)
    .sort((a, b) => b.score - a.score || b.confidence.localeCompare(a.confidence) || a.id.localeCompare(b.id));
  return { query: options.query, results };
}
```

Note: delete the now-redundant earlier `import type { ... } from "./shared-kb";` line from Task 2 if it duplicates this combined import — keep a single import block.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cq-adapter.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/core/cq-adapter.ts tests/cq-adapter.test.ts
git commit -m "feat(cq): cqSearch fetches, maps, and scores cq knowledge"
```

---

### Task 4: cq endpoint descriptor in repo config

**Files:**
- Modify: `src/core/shared-kb-config.ts`
- Test: `tests/shared-kb-config.test.ts`

**Interfaces:**
- Consumes: existing `SharedKbConfig`, `readSharedKbConfig` in `shared-kb-config.ts`.
- Produces: `export interface SharedKbCqConfig { url: string; api_key_ref?: string; domains?: string[] }`; `SharedKbConfig.shared_kb.cq?: SharedKbCqConfig`; `readSharedKbConfig` returns `cq` when present in `.barry-cache/config.json`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/shared-kb-config.test.ts (inside the existing describe block)
test("reads a cq endpoint descriptor when present", async () => {
  await withTempRepo(async (repo) => {
    const path = join(repo, ".barry-cache/config.json");
    await Bun.write(path, JSON.stringify({
      shared_kb: {
        contribution: "share_enabled",
        cq: { url: "https://cq.example.com", api_key_ref: "env:CQ_TOKEN", domains: ["testing"] },
      },
    }));
    const config = await readSharedKbConfig({ repo });
    expect(config.shared_kb.cq).toEqual({
      url: "https://cq.example.com",
      api_key_ref: "env:CQ_TOKEN",
      domains: ["testing"],
    });
  });
});

test("omits cq when the descriptor has no url", async () => {
  await withTempRepo(async (repo) => {
    const path = join(repo, ".barry-cache/config.json");
    await Bun.write(path, JSON.stringify({ shared_kb: { contribution: "local_only", cq: { domains: ["x"] } } }));
    const config = await readSharedKbConfig({ repo });
    expect(config.shared_kb.cq).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/shared-kb-config.test.ts`
Expected: FAIL — `config.shared_kb.cq` is `undefined` (first test).

- [ ] **Step 3: Write minimal implementation**

```typescript
// in src/core/shared-kb-config.ts

// add interface near SharedKbBrainConfig:
export interface SharedKbCqConfig {
  url: string;
  api_key_ref?: string;
  domains?: string[];
}

// extend SharedKbConfig:
export interface SharedKbConfig {
  shared_kb: {
    contribution: SharedKbContributionMode;
    brain?: SharedKbBrainConfig;
    cq?: SharedKbCqConfig;
  };
}

// replace the body of readSharedKbConfig with:
export async function readSharedKbConfig(options: { repo: string }): Promise<SharedKbConfig> {
  const path = sharedKbConfigPath(options.repo);
  if (!(await exists(path))) return { shared_kb: { contribution: defaultContribution } };

  const raw = JSON.parse(await readText(path)) as unknown;
  const contribution = readContributionMode(raw) ?? defaultContribution;
  const brain = readBrainConfig(raw);
  const cq = readCqConfig(raw);
  return {
    shared_kb: {
      contribution,
      ...(brain ? { brain } : {}),
      ...(cq ? { cq } : {}),
    },
  };
}

// add reader near readBrainConfig:
function readCqConfig(raw: unknown): SharedKbCqConfig | undefined {
  const cq = sharedKbSection(raw)?.cq;
  if (typeof cq !== "object" || cq === null) return undefined;
  const candidate = cq as { url?: unknown; api_key_ref?: unknown; domains?: unknown };
  if (typeof candidate.url !== "string" || candidate.url.length === 0) return undefined;
  const config: SharedKbCqConfig = { url: candidate.url };
  if (typeof candidate.api_key_ref === "string") config.api_key_ref = candidate.api_key_ref;
  if (Array.isArray(candidate.domains) && candidate.domains.every((d) => typeof d === "string")) {
    config.domains = candidate.domains as string[];
  }
  return config;
}

// extend sharedKbSection's return type to include cq:
function sharedKbSection(raw: unknown): { contribution?: unknown; brain?: unknown; cq?: unknown } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const sharedKb = (raw as { shared_kb?: unknown }).shared_kb;
  if (typeof sharedKb !== "object" || sharedKb === null) return undefined;
  return sharedKb as { contribution?: unknown; brain?: unknown; cq?: unknown };
}
```

Note: `writeSharedKbContributionMode` already spreads `current.shared_kb.brain`; also preserve `cq` there — add `...(current.shared_kb.cq ? { cq: current.shared_kb.cq } : {})` to its `next` object so writing a mode does not drop the cq descriptor.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/shared-kb-config.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/shared-kb-config.ts tests/shared-kb-config.test.ts
git commit -m "feat(cq): read a cq endpoint descriptor from repo config"
```

---

### Task 5: Wire `kb search --source cq` into the CLI

**Files:**
- Modify: `src/cli.ts` (imports near lines 9-14; `kb search` branch at lines 397-408; add a helper)
- Test: `tests/cli-kb.test.ts`

**Interfaces:**
- Consumes: `cqSearch` (Task 3), `readSharedKbConfig` + `SharedKbCqConfig` (Task 4), existing `formatKbSearchResults`, `print`.
- Produces: `kb search --source cq --query "..."` calls cq when `shared_kb.cq.url` is set and mode is `share_enabled`; resolves an `env:NAME` `api_key_ref`; errors clearly when cq is unconfigured.

- [ ] **Step 1: Write the failing test**

```typescript
// in tests/cli-kb.test.ts — follow the file's existing pattern for invoking the CLI.
// This test sets up a share-enabled repo with a cq descriptor and a stub server, then asserts
// `kb search --source cq` returns a mapped hit. Use the file's existing CLI runner + temp repo
// helper; the assertion shape is what matters:

test("kb search --source cq returns mapped cq results", async () => {
  await withTempRepo(async (repo) => {
    await Bun.write(join(repo, ".barry-cache/config.json"), JSON.stringify({
      shared_kb: { contribution: "share_enabled", cq: { url: "http://127.0.0.1:0", domains: ["ci"] } },
    }));
    // Start a stub HTTP server returning a cq KnowledgeUnitList for GET /api/v1/knowledge:
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({
        data: [{ id: "ku_x", confidence: 0.8, insight: { summary: "flaky ci", detail: "tests flake", action: "retry" } }],
      }), { status: 200 }),
    });
    try {
      await Bun.write(join(repo, ".barry-cache/config.json"), JSON.stringify({
        shared_kb: { contribution: "share_enabled", cq: { url: `http://127.0.0.1:${server.port}` } },
      }));
      const result = await runCli(["kb", "search", "--source", "cq", "--query", "flaky", "--json"], repo);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).results[0].id).toBe("ku_x");
    } finally {
      server.stop(true);
    }
  });
});

test("kb search --source cq requires share-enabled mode", async () => {
  await withTempRepo(async (repo) => {
    await Bun.write(join(repo, ".barry-cache/config.json"), JSON.stringify({
      shared_kb: { contribution: "preview_only", cq: { url: "https://cq.example.com" } },
    }));
    const result = await runCli(["kb", "search", "--source", "cq", "--query", "x"], repo);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("share-enabled");
  });
});
```

(Use the existing `runCli`/temp-repo helpers already imported in `tests/cli-kb.test.ts`; match their exact names. If the suite invokes `main()` directly instead of a `runCli` wrapper, follow that pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli-kb.test.ts`
Expected: FAIL — `--source cq` currently falls through to `searchSharedKb`, which tries to read a local index and errors (not the cq path / not the share-enabled gate message).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/cli.ts — extend the shared-kb-config import (line ~10) to add the cq type:
import { formatSharedKbContributionMode, readSharedKbConfig, sharedKbContributionModes, toSharedKbContributionMode, writeSharedKbContributionMode, type SharedKbConfig, type SharedKbCqConfig } from "./core/shared-kb-config";

// add a new import for the adapter:
import { cqSearch } from "./core/cq-adapter";

// in the `kb search` branch (currently lines 397-408), insert a cq fast-path BEFORE the
// assertRemoteSharedKbSearchAllowed/searchSharedKb call:
if (action === "search") {
  const source = requiredString(parsed, "source", commandUsage("kb search"));
  const query = requiredString(parsed, "query", commandUsage("kb search"));
  if (source === "cq") {
    await handleKbSearchCq(parsed, repo, json, query);
    return;
  }
  await assertRemoteSharedKbSearchAllowed(repo, source);
  const result = await searchSharedKb({
    source,
    query,
    includeReviewed: parsed.flags.get("include-reviewed") === true,
  });
  print(result, json, formatKbSearchResults(result));
  return;
}

// add the helper near assertRemoteSharedKbSearchAllowed:
async function handleKbSearchCq(parsed: ParsedArgs, repo: string, json: boolean, query: string): Promise<void> {
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution !== "share_enabled") {
    throw new CliArgumentError("cq search requires share-enabled mode. Run `barry-cache kb sharing set share-enabled`.", {
      usage: commandUsage("kb sharing set"),
      options: { mode: [...sharedKbContributionModes] },
    });
  }
  const cq = config.shared_kb.cq;
  if (!cq) {
    throw new CliArgumentError("No cq endpoint configured. Set shared_kb.cq.url in .barry-cache/config.json.", { usage: commandUsage("kb search") });
  }
  const searchOptions: Parameters<typeof cqSearch>[0] = { endpoint: cq.url, query };
  if (cq.domains) searchOptions.domains = cq.domains;
  const apiKey = resolveCqApiKey(cq);
  if (apiKey) searchOptions.apiKey = apiKey;
  const result = await cqSearch(searchOptions);
  print(result, json, formatKbSearchResults(result));
}

function resolveCqApiKey(cq: SharedKbCqConfig): string | undefined {
  if (!cq.api_key_ref) return undefined;
  const match = /^env:(.+)$/.exec(cq.api_key_ref);
  if (!match) return undefined;
  const name = match[1];
  return name ? process.env[name] : undefined;
}
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `bun test`
Expected: PASS — all existing tests plus the new cq tests; no regressions.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/cli.ts tests/cli-kb.test.ts
git commit -m "feat(cq): kb search --source cq queries a configured cq endpoint"
```

---

### Task 6: Record the feature in canonical memory

**Files:**
- Modify: `docs/context/features/shared-kb/FACTS.jsonl`
- Modify: `docs/context/features/shared-kb/IDMAP.md`

- [ ] **Step 1: Add IDMAP tokens**

Append to `docs/context/features/shared-kb/IDMAP.md`:

```
- `CQ_ADAPTER`: src/core/cq-adapter.ts
- `CQ_ADAPTER_TEST`: tests/cq-adapter.test.ts
```

- [ ] **Step 2: Add implemented facts** (use a real ISO 8601 timestamp from `date -u +%Y-%m-%dT%H:%M:%S.000Z`; keep the ID's timestamp segment matching it)

```jsonl
{"id":"SKB-<ISO-COMPACT>-cq01","subject":"barry-cache kb search --source cq","predicate":"queries","object":"a configured cq endpoint via GET /api/v1/knowledge through a versioned adapter, mapping cq knowledge_units to Barry search items, gated on share-enabled mode","src":["CQ_ADAPTER","CLI","CQ_ADAPTER_TEST","CLI_KB_TEST","CQ_INTEROP_ADR"],"status":"active","kind":"implemented","updated_at":"<ISO>","confidence":"high","tags":["shared-kb","cq","interop","search"]}
{"id":"SKB-<ISO-COMPACT>-cq02","subject":"cq endpoint descriptor","predicate":"is stored in",".barry-cache/config.json as shared_kb.cq with url, optional api_key_ref (env:NAME), and optional domains","src":["SHARED_KB_CONFIG","SHARED_KB_CONFIG_TEST","CQ_INTEROP_ADR"],"status":"active","kind":"implemented","updated_at":"<ISO>","confidence":"high","tags":["shared-kb","cq","config"]}
```

- [ ] **Step 3: Validate**

Run: `bun run barry -- validate`
Expected: `Barry Cache context is valid.`

- [ ] **Step 4: Commit**

```bash
git add docs/context/features/shared-kb/
git commit -m "docs(shared-kb): record cq consume adapter facts"
```

---

## Self-Review

**Spec coverage (vs. roadmap Phase 1):**
- Versioned adapter → `CQ_SCHEMA_VERSION` (Task 1). ✅
- Parse `data`-rooted `KnowledgeUnitList` + `next_cursor` → Task 1. ✅
- Map `knowledge_unit` → `SharedKbSearchItem` → Task 2. ✅
- `GET /api/v1/knowledge?domains=` consume + scoring → Task 3. ✅
- cq endpoint descriptor in `.barry-cache/config.json` → Task 4. ✅
- `kb search --source cq`, reuse remote-mode gating → Task 5. ✅
- Memory updated + validate clean → Task 6. ✅
- "Zero deletion / no existing behavior changed" → only additive code + a new CLI branch; `searchSharedKb` path untouched. ✅

**Placeholder scan:** every code/test step contains complete code; the only intentional fill-ins are the `<ISO>` timestamps in Task 6 (must be generated at write time, per repo policy) and matching the existing `runCli` helper name in `tests/cli-kb.test.ts`. Both are called out explicitly.

**Type consistency:** `cqUnitToSearchItem` returns `SharedKbSearchItem` (exact fields: id, kind, status, title, summary, tags, confidence, updated_at, text — verified against `searchItemForLesson`). `cqSearch` returns `SharedKbSearchResult` (`{ query, results }` with `score` added per item, matching `searchSharedKb`). `SharedKbCqConfig` is defined in Task 4 and consumed by name in Task 5. The Task 2 type-only import is merged into the Task 3 combined import (noted in Task 3 Step 3).

## Out of scope (Phase 2+)

Contributing to cq (`lessonToCqUnit`, provenance note, signing, `POST /api/v1/knowledge`), retargeting `kb submit`/`kb attest`, MCP-client transport, and any deletion of `brain/`/snapshot/maturation. See `docs/superpowers/plans/2026-06-19-cq-interop-pivot.md`.
