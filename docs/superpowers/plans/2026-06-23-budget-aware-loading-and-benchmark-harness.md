# Budget-aware loading + benchmark harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Amendment (shipped behavior — read first).** This plan predates two decisions
> made during implementation; where it says "opt-in" / "byte-identical with no
> `--budget`", the shipped behavior is: (1) the **CLI defaults budgeting on at 2000
> tokens/pack** (`DEFAULT_LOAD_BUDGET` — the benchmarked full-recall knee), with
> `load --expand all` for the full pack — the library API stays opt-in; (2)
> `loadContext` **deduplicates facts** (carried once at top level, not under
> `feature`); and (3) selection trims until the full emitted output fits the budget.
> `DEFAULT_BENCH_BUDGET` = 2000 (as in the plan body). ADR-0015 is canonical.

**Goal:** Add opt-in, lossless token-budget-aware loading to `load`/`resume`, plus a deterministic structural benchmark harness that measures token savings and recall.

**Architecture:** Two new pure modules — `tokens.ts` (pluggable token counting) and `budget.ts` (relevance-ranked, budget-bounded selection of a feature pack with CCR-style expansion) — consumed by the existing `load`/`resume` CLI paths. A `benchmark.ts` module + `bench` command run fixtures through route→load→budget and report metrics. All new behavior is opt-in; with no `--budget`, output is byte-identical to today.

**Tech Stack:** TypeScript, Bun (`bun test`), Node fs. No new runtime dependencies.

## Global Constraints

- Language/runtime: TypeScript on Node ≥ 20 / Bun; ESM (`import`/`export`), `.ts` sources under `src/`, tests under `tests/` using `bun:test`.
- No new runtime dependencies (only `serve-handler` is allowed today). Token counting is a zero-dep heuristic behind an interface.
- **Lossless invariant:** budgeting only *selects*; it never deletes or mutates `docs/context/`. Every dropped item stays on disk and is restorable via `--expand`.
- **Backward compatibility:** with no `--budget`, `load` and `resume` return the exact object shape they return today (verified by snapshot tests).
- **Determinism:** no `Date.now()`/`Math.random()` in ranking or metrics; all ordering has stable tie-breakers ending in `id` comparison.
- Default kind-keep weights: `decision=5, constraint=5, risk=4, implemented=3, test=2, open-question=2`. Confidence weights: `high=3, medium=2, low=1`.
- `DEFAULT_BENCH_BUDGET = 2000`. Budget precedence for `bench run`: `--budget` flag > fixture `budget` > default.
- Fixtures live at `docs/context/benchmarks/tasks.jsonl`; schema at `docs/context/schema/benchmark-task.schema.json`.
- **Git:** do NOT commit per task. Each task ends at its green-tests gate. The single branch + commit happens only in the final task (Task 9).

---

### Task 1: TokenCounter module

**Files:**
- Create: `src/core/tokens.ts`
- Test: `tests/tokens.test.ts`

**Interfaces:**
- Produces: `interface TokenCounter { count(text: string): number }`; `const heuristicCounter: TokenCounter`; `function getCounter(name?: string): TokenCounter`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tokens.test.ts
import { describe, expect, test } from "bun:test";
import { getCounter, heuristicCounter } from "../src/core/tokens";

describe("token counter", () => {
  test("heuristic counts ~chars/4 and is monotonic", () => {
    expect(heuristicCounter.count("")).toBe(0);
    expect(heuristicCounter.count("abcd")).toBe(1);
    expect(heuristicCounter.count("abcde")).toBe(2);
    expect(heuristicCounter.count("a".repeat(40))).toBe(10);
    expect(heuristicCounter.count("a".repeat(41))).toBeGreaterThan(heuristicCounter.count("a".repeat(40)));
  });

  test("getCounter returns heuristic by default and rejects unknown names", () => {
    expect(getCounter()).toBe(heuristicCounter);
    expect(getCounter("heuristic")).toBe(heuristicCounter);
    expect(() => getCounter("gpt")).toThrow("unknown token counter: gpt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tokens.test.ts`
Expected: FAIL — `Cannot find module '../src/core/tokens'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/tokens.ts
export interface TokenCounter {
  count(text: string): number;
}

// Approximate by design: ~4 chars per token. Budgets are coarse guidance.
export const heuristicCounter: TokenCounter = {
  count(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / 4);
  },
};

// Seam for a real BPE tokenizer later (e.g. getCounter("gpt")) without touching callers.
export function getCounter(name?: string): TokenCounter {
  if (name === undefined || name === "heuristic") return heuristicCounter;
  throw new Error(`unknown token counter: ${name}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tokens.test.ts`
Expected: PASS — 2 pass, 0 fail.

---

### Task 2: Budget selection module

**Files:**
- Create: `src/core/budget.ts`
- Test: `tests/budget.test.ts`

**Interfaces:**
- Consumes: `TokenCounter` from `./tokens`; `FactRecord`, `FeaturePack` from `./types`; `AdrRecord` from `./adr`.
- Produces:
  - `interface BudgetedAdr { id: string; title: string; summary: string }`
  - `interface DroppedItem { id: string; kind: string; tokens: number }`
  - `interface BudgetReport { budget: number; used: number; baseline_tokens: number; saved_pct: number; overflow: number; included: string[]; dropped: DroppedItem[]; expand_hint: string }`
  - `interface BudgetedContext { feature: { slug: string; title: string; summary: string }; facts: FactRecord[]; adrs: BudgetedAdr[]; sources: string[]; budget: BudgetReport }`
  - `interface BudgetInput { feature: FeaturePack; adrs: AdrRecord[]; sources: string[]; task: string; budget: number; counter: TokenCounter; expand?: string[] }`
  - `function budgetContext(input: BudgetInput): BudgetedContext`

- [ ] **Step 1: Write the failing test**

```ts
// tests/budget.test.ts
import { describe, expect, test } from "bun:test";
import { budgetContext } from "../src/core/budget";
import { heuristicCounter } from "../src/core/tokens";
import type { FactRecord, FeaturePack } from "../src/core/types";
import type { AdrRecord } from "../src/core/adr";

function fact(id: string, over: Partial<FactRecord> = {}): FactRecord {
  return {
    id, subject: "S", predicate: "p", object: "o",
    src: ["X1"], status: "active", kind: "implemented",
    updated_at: "2026-05-01T00:00:00.000Z", ...over,
  };
}

function pack(facts: FactRecord[]): FeaturePack {
  return {
    slug: "demo", dir: "/tmp/demo",
    readme: "# Demo Pack\n\nThe demo summary paragraph.\n\nMore detail here.\n",
    idmap: "# ID Map\n- `X1`: src/demo.ts\n", graph: "A owns B\n", facts,
  };
}

const NO_ADRS: AdrRecord[] = [];

describe("budgetContext", () => {
  test("includes core summary and ranks task-relevant facts first", () => {
    const facts = [
      fact("F1", { object: "unrelated thing" }),
      fact("F2", { object: "playback drift fix", tags: ["drift"] }),
    ];
    const out = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: ["docs/context/features/demo/README.md"],
      task: "fix playback drift", budget: 100000, counter: heuristicCounter,
    });
    expect(out.feature.title).toBe("Demo Pack");
    expect(out.feature.summary).toBe("The demo summary paragraph.");
    expect(out.facts[0]?.id).toBe("F2"); // higher relevance ranked first
    expect(out.budget.dropped).toHaveLength(0);
    expect(out.budget.saved_pct).toBe(0); // nothing dropped at a huge budget
  });

  test("drops lowest-ranked facts past the budget and lists them", () => {
    const facts = [fact("F1"), fact("F2"), fact("F3"), fact("F4")];
    const out = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: [],
      task: "", budget: 80, counter: heuristicCounter,
    });
    const droppedIds = out.budget.dropped.map((d) => d.id);
    // Every dropped id is still present in the source pack (lossless invariant).
    for (const id of droppedIds) {
      expect(facts.some((f) => f.id === id)).toBe(true);
    }
    expect(out.budget.used).toBeLessThanOrEqual(80);
    expect(droppedIds.length).toBeGreaterThan(0);
    expect(out.budget.saved_pct).toBeGreaterThan(0);
  });

  test("excludes superseded facts but restores them via expand", () => {
    const facts = [fact("F1"), fact("OLD", { status: "superseded" })];
    const base = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: [],
      task: "", budget: 100000, counter: heuristicCounter,
    });
    expect(base.facts.some((f) => f.id === "OLD")).toBe(false);

    const expanded = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: [],
      task: "", budget: 100000, counter: heuristicCounter, expand: ["OLD"],
    });
    expect(expanded.facts.some((f) => f.id === "OLD")).toBe(true);
  });

  test("summarizes ADRs by default and expands the full body on request", () => {
    const adr: AdrRecord = {
      id: "ADR-0001", title: "Use repo-native context", status: "active", date: "2026-05-19",
      supersedes: [], tags: [], path: "docs/context/adrs/ADR-0001-x.md",
      content: "The decision summary line.\n\nLong rationale that should not appear in the summary view.",
    };
    const summary = budgetContext({
      feature: pack([fact("F1")]), adrs: [adr], sources: [],
      task: "", budget: 100000, counter: heuristicCounter,
    });
    expect(summary.adrs[0]).toEqual({ id: "ADR-0001", title: "Use repo-native context", summary: "The decision summary line." });

    const full = budgetContext({
      feature: pack([fact("F1")]), adrs: [adr], sources: [],
      task: "", budget: 100000, counter: heuristicCounter, expand: ["ADR-0001"],
    });
    expect(full.adrs[0]?.summary).toContain("Long rationale");
  });

  test("forced expand is included even when it overflows the budget; overflow is reported", () => {
    const big = fact("BIG", { object: "x".repeat(400) });
    const out = budgetContext({
      feature: pack([big]), adrs: NO_ADRS, sources: [],
      task: "", budget: 10, counter: heuristicCounter, expand: ["BIG"],
    });
    expect(out.facts.some((f) => f.id === "BIG")).toBe(true);
    expect(out.budget.overflow).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/budget.test.ts`
Expected: FAIL — `Cannot find module '../src/core/budget'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/budget.ts
import type { AdrRecord } from "./adr";
import type { TokenCounter } from "./tokens";
import type { FactRecord, FeaturePack } from "./types";

const KIND_WEIGHT: Record<FactRecord["kind"], number> = {
  decision: 5, constraint: 5, risk: 4, implemented: 3, test: 2, "open-question": 2,
};
const CONFIDENCE_WEIGHT: Record<NonNullable<FactRecord["confidence"]>, number> = {
  high: 3, medium: 2, low: 1,
};

export interface BudgetedAdr {
  id: string;
  title: string;
  summary: string;
}

export interface DroppedItem {
  id: string;
  kind: string;
  tokens: number;
}

export interface BudgetReport {
  budget: number;
  used: number;
  baseline_tokens: number;
  saved_pct: number;
  overflow: number;
  included: string[];
  dropped: DroppedItem[];
  expand_hint: string;
}

export interface BudgetedContext {
  feature: { slug: string; title: string; summary: string };
  facts: FactRecord[];
  adrs: BudgetedAdr[];
  sources: string[];
  budget: BudgetReport;
}

export interface BudgetInput {
  feature: FeaturePack;
  adrs: AdrRecord[];
  sources: string[];
  task: string;
  budget: number;
  counter: TokenCounter;
  expand?: string[];
}

export function budgetContext(input: BudgetInput): BudgetedContext {
  const { feature, adrs, sources, budget, counter } = input;
  const expand = new Set(input.expand ?? []);
  const taskTokens = tokenize(input.task);
  // Measure exactly what print() would emit (2-space pretty JSON), so reported tokens match output.
  const cost = (value: unknown): number => counter.count(JSON.stringify(value, null, 2));

  const core = {
    slug: feature.slug,
    title: firstHeading(feature.readme) || feature.slug,
    summary: firstParagraph(feature.readme),
  };
  let used = cost(core);

  const includedFacts: FactRecord[] = [];
  const dropped: DroppedItem[] = [];

  // Forced (expanded) facts first — always included, even past budget.
  for (const f of feature.facts) {
    if (expand.has(f.id)) {
      includedFacts.push(f);
      used += cost(f);
    }
  }

  // Rank the rest; superseded/deprecated are excluded from default selection.
  const ranked = feature.facts
    .filter((f) => !expand.has(f.id) && f.status !== "superseded" && f.status !== "deprecated")
    .map((f) => ({ f, rel: relevance(factText(f), taskTokens) }))
    .sort((a, b) =>
      b.rel - a.rel ||
      KIND_WEIGHT[b.f.kind] - KIND_WEIGHT[a.f.kind] ||
      confidenceWeight(b.f) - confidenceWeight(a.f) ||
      cmpDateDesc(a.f.updated_at, b.f.updated_at) ||
      a.f.id.localeCompare(b.f.id))
    .map((entry) => entry.f);

  for (const f of ranked) {
    const c = cost(f);
    if (used + c <= budget) {
      includedFacts.push(f);
      used += c;
    } else {
      dropped.push({ id: f.id, kind: f.kind, tokens: c });
    }
  }

  // ADRs: title + summary by default; full body only when expanded.
  const adrViews: BudgetedAdr[] = [];
  for (const adr of adrs) {
    if (expand.has(adr.id)) {
      const full: BudgetedAdr = { id: adr.id, title: adr.title, summary: adr.content };
      adrViews.push(full);
      used += cost(full);
      continue;
    }
    const view: BudgetedAdr = { id: adr.id, title: adr.title, summary: firstParagraph(adr.content) };
    const c = cost(view);
    if (used + c <= budget) {
      adrViews.push(view);
      used += c;
    } else {
      dropped.push({ id: adr.id, kind: "adr", tokens: c });
    }
  }

  const baseline = cost({ feature, facts: feature.facts, sources, adrs });

  return {
    feature: core,
    facts: includedFacts,
    adrs: adrViews,
    sources,
    budget: {
      budget,
      used,
      baseline_tokens: baseline,
      saved_pct: baseline > 0 ? round4(1 - used / baseline) : 0,
      overflow: Math.max(0, used - budget),
      included: includedFacts.map((f) => f.id),
      dropped,
      expand_hint: `barry-cache load --route ${feature.slug} --budget ${budget} --expand <ID> (or --expand all for the full pack)`,
    },
  };
}

function confidenceWeight(fact: FactRecord): number {
  return fact.confidence ? CONFIDENCE_WEIGHT[fact.confidence] : 0;
}

function factText(fact: FactRecord): string {
  return [fact.id, fact.subject, fact.predicate, fact.object, fact.status, fact.kind, ...fact.src, ...(fact.tags ?? [])].join(" ");
}

function tokenize(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

function relevance(text: string, taskTokens: string[]): number {
  const haystack = text.toLowerCase();
  return taskTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function firstHeading(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.*)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function firstParagraph(markdown: string): string {
  const collected: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.length === 0) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(trimmed);
  }
  return collected.join(" ");
}

function cmpDateDesc(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/budget.test.ts`
Expected: PASS — 5 pass, 0 fail.

---

### Task 3: Wire budgeting into `load`

**Files:**
- Modify: `src/cli.ts` (the `case "load"` block ~`src/cli.ts:90-93`; add helper `optionalPositiveInt`; add imports; add usage string)
- Test: `tests/cli-load-budget.test.ts`

**Interfaces:**
- Consumes: `budgetContext`/`BudgetInput` from `./core/budget`; `getCounter` from `./core/tokens`; existing `loadContext`.
- Produces: `load --route X [--task "..."] [--budget N] [--expand <ID|all>]` CLI behavior. `main(argv)` is the test entrypoint (export it — see Step 3).

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli-load-budget.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadContext } from "../src/core/context";
import { budgetContext } from "../src/core/budget";
import { getCounter } from "../src/core/tokens";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

async function addPack(repo: string, factCount: number): Promise<void> {
  const dir = join(repo, "docs/context/features/demo");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# Demo\n\nDemo summary.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `X1`: src/demo.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  const rows = Array.from({ length: factCount }, (_, i) =>
    JSON.stringify({
      id: `D${i}`, subject: "S", predicate: "p", object: `object ${i}`,
      src: ["X1"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
    }));
  await writeFile(join(dir, "FACTS.jsonl"), rows.join("\n") + "\n");
}

describe("load budgeting", () => {
  test("budgeted load drops facts and stays within budget; raw load is unchanged", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo, 12);

      const raw = await loadContext({ repo, route: "demo" });
      expect(raw.facts).toHaveLength(12); // backward compatible: full pack

      const budgeted = budgetContext({
        feature: raw.feature!, adrs: raw.adrs, sources: raw.sources,
        task: "", budget: 120, counter: getCounter(),
      });
      expect(budgeted.budget.used).toBeLessThanOrEqual(120);
      expect(budgeted.facts.length).toBeLessThan(12);
      expect(budgeted.budget.dropped.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli-load-budget.test.ts`
Expected: FAIL — `raw.feature!` path or assertions mismatch (module wiring not yet present if imports renamed). If it passes here it only proves the core modules; the CLI wiring below makes the flags usable.

- [ ] **Step 3: Wire the CLI**

In `src/cli.ts`, add imports near the existing core imports (top of file):

```ts
import { budgetContext } from "./core/budget";
import { getCounter } from "./core/tokens";
```

Replace the `case "load"` block (`src/cli.ts:90-93`) with:

```ts
      case "load": {
        const route = requiredString(parsed, "route", commandUsage("load"));
        const loaded = await loadContext({ repo, route });
        const budget = optionalPositiveInt(parsed, "budget", commandUsage("load"));
        const expand = optionalList(parsed, "expand", commandUsage("load"));
        if (budget === undefined || expand.includes("all") || loaded.feature === null) {
          print(loaded, json);
          break;
        }
        const task = optionalString(parsed, "task", commandUsage("load")) ?? "";
        print(budgetContext({
          feature: loaded.feature,
          adrs: loaded.adrs,
          sources: loaded.sources,
          task,
          budget,
          counter: getCounter(),
          expand,
        }), json);
        break;
      }
```

Add the `optionalPositiveInt` helper next to `optionalNumber` (after `src/cli.ts:254`):

```ts
function optionalPositiveInt(parsed: ParsedArgs, key: string, usageValue?: string): number | undefined {
  const value = parsed.flags.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`--${key} requires a number`, { usage: usageValue });
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) throw new CliArgumentError(`--${key} must be a positive integer`, { usage: usageValue });
  return parsedValue;
}
```

Update the `load` usage string in `commandUsage` (replace the existing `load:` line):

```ts
    load: 'barry-cache load --route "..." [--task "..."] [--budget N] [--expand ID1,ID2|all] [--json]',
```

Ensure `main` is exported so tests can call it directly. At the bottom of `src/cli.ts`, find the entrypoint call (e.g. `main();` or `void main();`) and change the `async function main(...)` declaration to `export async function main(...)`. Keep the existing bottom-of-file invocation guarded as it is.

- [ ] **Step 4: Run the test and the full suite**

Run: `bun test tests/cli-load-budget.test.ts && bun run typecheck`
Expected: PASS — 1 pass; typecheck clean.

---

### Task 4: `resume --budget` preview

**Files:**
- Modify: `src/core/context.ts` (`resumeProject` ~`src/core/context.ts:117-140`)
- Modify: `src/cli.ts` (`case "resume"` ~`src/cli.ts:95-98`; `resume` usage string)
- Test: `tests/resume-budget.test.ts`

**Interfaces:**
- Consumes: `budgetContext`, `BudgetedContext` from `./budget`; `getCounter` from `./tokens`; existing `loadContext`, `routeTask`.
- Produces: `resumeProject({ repo, task, budget? })` returns the same object as today plus an optional `context_preview?: BudgetedContext` when `budget` is set and at least one route matches.

- [ ] **Step 1: Write the failing test**

```ts
// tests/resume-budget.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resumeProject } from "../src/core/context";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

async function addPack(repo: string): Promise<void> {
  const dir = join(repo, "docs/context/features/renderer-runtime");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# Renderer Runtime\n\nOwns the transport clock.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `F01`: src/runtime/clock.ts\n");
  await writeFile(join(dir, "KG.adj"), "A0 owns transport-clock\n");
  await writeFile(join(dir, "FACTS.jsonl"), JSON.stringify({
    id: "RR001", subject: "A0", predicate: "owns", object: "transport clock drift",
    src: ["F01"], status: "active", kind: "implemented", updated_at: "2026-05-17T00:00:00.000Z",
  }) + "\n");
}

describe("resume budgeting", () => {
  test("no budget => no context_preview (backward compatible)", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo);
      const resume = await resumeProject({ repo, task: "fix transport clock drift" });
      expect("context_preview" in resume).toBe(false);
    });
  });

  test("with budget => attaches a budgeted preview of the top route", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo);
      const resume = await resumeProject({ repo, task: "fix transport clock drift", budget: 100000 });
      expect(resume.context_preview?.feature.slug).toBe("renderer-runtime");
      expect(resume.context_preview?.facts[0]?.id).toBe("RR001");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resume-budget.test.ts`
Expected: FAIL — `resumeProject` does not accept `budget` / no `context_preview`.

- [ ] **Step 3: Implement**

In `src/core/context.ts`, add imports at the top:

```ts
import { budgetContext, type BudgetedContext } from "./budget";
import { getCounter } from "./tokens";
```

Change the `resumeProject` signature param to accept an optional budget, and its return type to include the optional preview. Replace the `resumeProject` declaration line and its `return { ... }` with:

```ts
export async function resumeProject({ repo, task, budget }: { repo: string; task: string; budget?: number }): Promise<{
  task: string;
  context: RouteResult;
  execution_contract: {
    task_goal: string;
    first_action: string;
    edit_scope: string[];
    validation_commands: string[];
    contract_strength: "soft";
  };
  context_preview?: BudgetedContext;
}> {
  const context = await routeTask({ repo, task });
  const selected = context.routes.slice(0, 3).map((route) => route.slug);
  const firstAction = selected.length > 0
    ? `load ${selected.join(", ")} context packs`
    : "load docs/context/INDEX.md and identify the smallest relevant context pack";
  const base = {
    task,
    context,
    execution_contract: {
      task_goal: task,
      first_action: firstAction,
      edit_scope: selected.map((slug) => `docs/context/features/${slug}/**`),
      validation_commands: ["barry-cache validate"],
      contract_strength: "soft" as const,
    },
  };
  if (budget === undefined || selected.length === 0) return base;
  const loaded = await loadContext({ repo, route: selected[0]! });
  if (loaded.feature === null) return base;
  return {
    ...base,
    context_preview: budgetContext({
      feature: loaded.feature,
      adrs: loaded.adrs,
      sources: loaded.sources,
      task,
      budget,
      counter: getCounter(),
    }),
  };
}
```

In `src/cli.ts`, replace the `case "resume"` block (`src/cli.ts:95-98`):

```ts
      case "resume": {
        const task = requiredString(parsed, "task", commandUsage("resume"));
        const budget = optionalPositiveInt(parsed, "budget", commandUsage("resume"));
        const resumeOptions: Parameters<typeof resumeProject>[0] = { repo, task };
        if (budget !== undefined) resumeOptions.budget = budget;
        print(await resumeProject(resumeOptions), json);
        break;
      }
```

Update the `resume` usage string in `commandUsage`:

```ts
    resume: 'barry-cache resume --task "..." [--budget N] [--json]',
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/resume-budget.test.ts tests/context-flow.test.ts && bun run typecheck`
Expected: PASS — resume-budget 2 pass; context-flow still green (backward compatible); typecheck clean.

---

### Task 5: Benchmark fixture schema + validation

**Files:**
- Create: `docs/context/schema/benchmark-task.schema.json`
- Modify: `src/core/validate.ts` (add `validateBenchmarkTasks` + `benchmarkTaskErrors`; call it inside `validateProject`)
- Test: `tests/benchmark-validate.test.ts`

**Interfaces:**
- Produces: `export function benchmarkTaskErrors(value: unknown): string[]` (reused by Task 6/7); `validateProject` now also reports errors for malformed `docs/context/benchmarks/tasks.jsonl` rows when the file exists.

- [ ] **Step 1: Write the failing test**

```ts
// tests/benchmark-validate.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
import { benchmarkTaskErrors } from "../src/core/validate";
import { withTempRepo } from "./helpers";

describe("benchmark fixture validation", () => {
  test("benchmarkTaskErrors flags missing/!typed fields", () => {
    expect(benchmarkTaskErrors({ id: "B1", task: "t", expect_packs: ["demo"] })).toEqual([]);
    expect(benchmarkTaskErrors({ id: "B1", task: "t" })).toContain("missing required field: expect_packs");
    expect(benchmarkTaskErrors({ id: "B1", task: "t", expect_packs: [] })).toContain("invalid field: expect_packs");
    expect(benchmarkTaskErrors({ id: "B1", task: "t", expect_packs: ["demo"], budget: 0 })).toContain("invalid field: budget");
  });

  test("validateProject reports malformed fixture rows by line", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const dir = join(repo, "docs/context/benchmarks");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "tasks.jsonl"), '{"id":"B1","task":"t"}\n');
      const result = await validateProject({ repo });
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/benchmarks/tasks.jsonl",
        line: 1,
        message: "missing required field: expect_packs",
      }));
    });
  });

  test("validateProject ignores an absent fixtures file", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const result = await validateProject({ repo });
      expect(result.ok).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/benchmark-validate.test.ts`
Expected: FAIL — `benchmarkTaskErrors` not exported.

- [ ] **Step 3: Create the schema file**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache benchmark task",
  "type": "object",
  "required": ["id", "task", "expect_packs"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "task": { "type": "string", "minLength": 1 },
    "expect_packs": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "expect_facts": { "type": "array", "items": { "type": "string" } },
    "budget": { "type": "integer", "minimum": 1 }
  }
}
```

- [ ] **Step 4: Implement validation in `src/core/validate.ts`**

Add `await`-driven call inside `validateProject`, right before `return { ok: ... }` (after `src/core/validate.ts:96`):

```ts
  errors.push(...await validateBenchmarkTasks(repo));
```

Add these functions to `src/core/validate.ts` (e.g. after `validateGraph`):

```ts
export function benchmarkTaskErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["benchmark task must be an object"];
  const task = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of ["id", "task"] as const) {
    if (task[key] === undefined) errors.push(`missing required field: ${key}`);
    else if (typeof task[key] !== "string" || (task[key] as string).length === 0) errors.push(`invalid field: ${key}`);
  }
  if (task.expect_packs === undefined) {
    errors.push("missing required field: expect_packs");
  } else if (!Array.isArray(task.expect_packs) || task.expect_packs.length === 0 || task.expect_packs.some((item) => typeof item !== "string")) {
    errors.push("invalid field: expect_packs");
  }
  if (task.expect_facts !== undefined && (!Array.isArray(task.expect_facts) || task.expect_facts.some((item) => typeof item !== "string"))) {
    errors.push("invalid field: expect_facts");
  }
  if (task.budget !== undefined && (typeof task.budget !== "number" || !Number.isInteger(task.budget) || task.budget < 1)) {
    errors.push("invalid field: budget");
  }
  return errors;
}

async function validateBenchmarkTasks(repo: string): Promise<CommandIssue[]> {
  const path = repoPath(repo, "docs/context/benchmarks/tasks.jsonl");
  if (!(await exists(path))) return [];
  const file = "docs/context/benchmarks/tasks.jsonl";
  const errors: CommandIssue[] = [];
  const seen = new Set<string>();
  const rows = (await readTextIfExists(path)).split(/\r?\n/);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? "";
    if (row.trim().length === 0) continue;
    const line = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(row) as unknown;
    } catch {
      errors.push({ file, line, message: "invalid JSON" });
      continue;
    }
    for (const message of benchmarkTaskErrors(value)) errors.push({ file, line, message });
    if (hasStringField(value, "id")) {
      if (seen.has(value.id)) errors.push({ file, line, message: `duplicate benchmark task id: ${value.id}` });
      seen.add(value.id);
    }
  }
  return errors;
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/benchmark-validate.test.ts tests/cli-validate.test.ts && bun run typecheck`
Expected: PASS — benchmark-validate 3 pass; existing validate tests still green.

---

### Task 6: Benchmark run + `bench run` command

**Files:**
- Create: `src/core/benchmark.ts`
- Modify: `src/cli.ts` (add `case "bench"`, `handleBenchCommand`, `formatBenchReport`; imports; usage strings; `usageText`)
- Test: `tests/benchmark-run.test.ts`

**Interfaces:**
- Consumes: `routeTask`, `loadContext` from `./context`; `budgetContext` from `./budget`; `getCounter`, `TokenCounter` from `./tokens`; `benchmarkTaskErrors` from `./validate`; `readContextSnapshot` from `./context-cache`.
- Produces:
  - `interface BenchmarkTask { id: string; task: string; expect_packs: string[]; expect_facts?: string[]; budget?: number }`
  - `interface BenchmarkTaskResult { id; task; routed_packs: string[]; baseline_tokens; loaded_tokens; tokens_saved_pct; pack_recall; fact_recall; budget_overflow }`
  - `interface BenchmarkReport { tasks: BenchmarkTaskResult[]; mean_tokens_saved_pct; mean_pack_recall; mean_fact_recall; recall_regressions; corpus_baseline_pct }`
  - `const DEFAULT_BENCH_BUDGET = 2000`
  - `async function readBenchmarkTasks(repo: string): Promise<{ tasks: BenchmarkTask[]; skipped: number }>`
  - `async function runBenchmark(opts: { repo: string; budget?: number; counter?: TokenCounter }): Promise<BenchmarkReport>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/benchmark-run.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { runBenchmark, readBenchmarkTasks } from "../src/core/benchmark";
import { withTempRepo } from "./helpers";

async function addPack(repo: string, slug: string, factObjects: string[]): Promise<void> {
  const dir = join(repo, "docs/context/features/" + slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), `# ${slug}\n\n${slug} summary.\n`);
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `X1`: src/x.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  const rows = factObjects.map((object, i) => JSON.stringify({
    id: `${slug.toUpperCase()}${i}`, subject: "S", predicate: "p", object,
    src: ["X1"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
  }));
  await writeFile(join(dir, "FACTS.jsonl"), rows.join("\n") + "\n");
}

async function writeFixtures(repo: string, lines: object[]): Promise<void> {
  const dir = join(repo, "docs/context/benchmarks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("benchmark run", () => {
  test("missing fixtures => empty report", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const { tasks } = await readBenchmarkTasks(repo);
      expect(tasks).toHaveLength(0);
      const report = await runBenchmark({ repo });
      expect(report.tasks).toHaveLength(0);
    });
  });

  test("computes recall and savings for a fixture", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo, "renderer", ["transport clock drift", "frame scheduler", "buffer pool", "audio sync"]);
      await writeFixtures(repo, [
        { id: "B1", task: "fix transport clock drift in renderer", expect_packs: ["renderer"], expect_facts: ["RENDERER0"], budget: 120 },
      ]);
      const report = await runBenchmark({ repo });
      expect(report.tasks[0]?.pack_recall).toBe(1);
      expect(report.tasks[0]?.fact_recall).toBe(1);
      expect(report.tasks[0]?.tokens_saved_pct).toBeGreaterThan(0);
      expect(report.tasks[0]?.budget_overflow).toBe(0);
      expect(report.recall_regressions).toBe(0);
    });
  });

  test("counts a recall regression when an expected pack is not routed", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo, "renderer", ["transport clock drift"]);
      await writeFixtures(repo, [
        { id: "B2", task: "transport clock drift", expect_packs: ["nonexistent-pack"] },
      ]);
      const report = await runBenchmark({ repo });
      expect(report.tasks[0]?.pack_recall).toBe(0);
      expect(report.recall_regressions).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/benchmark-run.test.ts`
Expected: FAIL — `Cannot find module '../src/core/benchmark'`.

- [ ] **Step 3: Implement `src/core/benchmark.ts`**

```ts
// src/core/benchmark.ts
import { budgetContext } from "./budget";
import { readContextSnapshot } from "./context-cache";
import { loadContext, routeTask } from "./context";
import { repoPath } from "./fs";
import { readTextIfExists } from "./fs";
import { getCounter, type TokenCounter } from "./tokens";
import { benchmarkTaskErrors } from "./validate";

export const DEFAULT_BENCH_BUDGET = 2000;

export interface BenchmarkTask {
  id: string;
  task: string;
  expect_packs: string[];
  expect_facts?: string[];
  budget?: number;
}

export interface BenchmarkTaskResult {
  id: string;
  task: string;
  routed_packs: string[];
  baseline_tokens: number;
  loaded_tokens: number;
  tokens_saved_pct: number;
  pack_recall: number;
  fact_recall: number;
  budget_overflow: number;
}

export interface BenchmarkReport {
  tasks: BenchmarkTaskResult[];
  mean_tokens_saved_pct: number;
  mean_pack_recall: number;
  mean_fact_recall: number;
  recall_regressions: number;
  corpus_baseline_pct: number;
}

export async function readBenchmarkTasks(repo: string): Promise<{ tasks: BenchmarkTask[]; skipped: number }> {
  const text = await readTextIfExists(repoPath(repo, "docs/context/benchmarks/tasks.jsonl"));
  const tasks: BenchmarkTask[] = [];
  let skipped = 0;
  for (const row of text.split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(row) as unknown;
    } catch {
      skipped++;
      continue;
    }
    if (benchmarkTaskErrors(value).length > 0) {
      skipped++;
      continue;
    }
    tasks.push(value as BenchmarkTask);
  }
  return { tasks, skipped };
}

export async function runBenchmark({ repo, budget, counter = getCounter() }: { repo: string; budget?: number; counter?: TokenCounter }): Promise<BenchmarkReport> {
  const { tasks } = await readBenchmarkTasks(repo);
  const corpusTokens = await corpusBaselineTokens(repo, counter);
  const results: BenchmarkTaskResult[] = [];

  for (const task of tasks) {
    const routed = (await routeTask({ repo, task: task.task })).routes.slice(0, 3).map((route) => route.slug);
    const effectiveBudget = budget ?? task.budget ?? DEFAULT_BENCH_BUDGET;

    let baseline = 0;
    let loaded = 0;
    let overflow = 0;
    const includedFactIds = new Set<string>();

    for (const slug of routed) {
      const pack = await loadContext({ repo, route: slug });
      if (pack.feature === null) continue;
      const budgeted = budgetContext({
        feature: pack.feature, adrs: pack.adrs, sources: pack.sources,
        task: task.task, budget: effectiveBudget, counter,
      });
      baseline += budgeted.budget.baseline_tokens;
      loaded += budgeted.budget.used;
      overflow += budgeted.budget.overflow;
      for (const id of budgeted.budget.included) includedFactIds.add(id);
    }

    const expectedPacks = task.expect_packs;
    const packHits = expectedPacks.filter((slug) => routed.includes(slug)).length;
    const expectedFacts = task.expect_facts ?? [];
    const factHits = expectedFacts.filter((id) => includedFactIds.has(id)).length;

    results.push({
      id: task.id,
      task: task.task,
      routed_packs: routed,
      baseline_tokens: baseline,
      loaded_tokens: loaded,
      tokens_saved_pct: baseline > 0 ? round4(1 - loaded / baseline) : 0,
      pack_recall: expectedPacks.length > 0 ? round4(packHits / expectedPacks.length) : 1,
      fact_recall: expectedFacts.length > 0 ? round4(factHits / expectedFacts.length) : 1,
      budget_overflow: overflow,
    });
  }

  const regressions = results.filter((r) => r.pack_recall < 1 || r.fact_recall < 1).length;
  const meanLoaded = mean(results.map((r) => r.loaded_tokens));
  return {
    tasks: results,
    mean_tokens_saved_pct: round4(mean(results.map((r) => r.tokens_saved_pct))),
    mean_pack_recall: round4(mean(results.map((r) => r.pack_recall))),
    mean_fact_recall: round4(mean(results.map((r) => r.fact_recall))),
    recall_regressions: regressions,
    corpus_baseline_pct: corpusTokens > 0 ? round4(meanLoaded / corpusTokens) : 0,
  };
}

async function corpusBaselineTokens(repo: string, counter: TokenCounter): Promise<number> {
  const { features } = await readContextSnapshot(repo);
  let total = 0;
  for (const feature of features) {
    total += counter.count(JSON.stringify({ feature, facts: feature.facts }, null, 2));
  }
  return total;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
```

> Note: `readTextIfExists` returns `""` for an absent file (see `src/core/fs.ts`), so `readBenchmarkTasks` returns no tasks when the fixtures file is missing — no special-casing needed.

- [ ] **Step 4: Wire the `bench` command in `src/cli.ts`**

Add imports near the other core imports:

```ts
import { runBenchmark, readBenchmarkTasks, seedBenchmarkTasks, writeSeededTasks, type BenchmarkReport } from "./core/benchmark";
```

> `seedBenchmarkTasks`/`writeSeededTasks` are added in Task 7; import them now so the `bench` handler compiles once Task 7 lands. If implementing strictly task-by-task, import only `runBenchmark`/`readBenchmarkTasks`/`BenchmarkReport` here and add the seed imports in Task 7.

Add a `case "bench"` to the `switch` (next to `case "review"`):

```ts
      case "bench": {
        await handleBenchCommand(parsed, repo, json);
        break;
      }
```

Add the handler and formatter (near `handleAdrCommand`):

```ts
async function handleBenchCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const action = parsed.positionals[0];
  if (action === "run") {
    const budget = optionalPositiveInt(parsed, "budget", commandUsage("bench run"));
    const { tasks } = await readBenchmarkTasks(repo);
    if (tasks.length === 0) {
      print({ tasks: [], mean_tokens_saved_pct: 0, mean_pack_recall: 0, mean_fact_recall: 0, recall_regressions: 0, corpus_baseline_pct: 0 }, json,
        "No benchmark fixtures found. Run `barry-cache bench seed` or create docs/context/benchmarks/tasks.jsonl.");
      return;
    }
    const report = await runBenchmark(budget === undefined ? { repo } : { repo, budget });
    print(report, json, formatBenchReport(report));
    return;
  }
  if (action === "seed") {
    await handleBenchSeedCommand(parsed, repo, json); // defined in Task 7
    return;
  }
  throw new CliArgumentError(action ? `Unknown bench action: ${action}` : "Missing bench action", {
    usage: commandUsage("bench"),
  });
}

function formatBenchReport(report: BenchmarkReport): string {
  if (report.tasks.length === 0) return "No benchmark tasks.";
  const lines = report.tasks.map((task) =>
    `  ${task.id}  saved ${pct(task.tokens_saved_pct)}  pack ${pct(task.pack_recall)}  fact ${pct(task.fact_recall)}` +
    (task.budget_overflow > 0 ? `  overflow ${task.budget_overflow}` : ""));
  return [
    `Benchmarked ${report.tasks.length} task(s):`,
    ...lines,
    "",
    `Mean tokens saved: ${pct(report.mean_tokens_saved_pct)}`,
    `Mean pack recall:  ${pct(report.mean_pack_recall)}`,
    `Mean fact recall:  ${pct(report.mean_fact_recall)}`,
    `Recall regressions: ${report.recall_regressions}`,
    `Budgeted load vs full corpus: ${pct(report.corpus_baseline_pct)}`,
  ].join("\n");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
```

Add usage strings to `commandUsage`:

```ts
    bench: "barry-cache bench <run|seed> [--json]",
    "bench run": "barry-cache bench run [--budget N] [--json]",
    "bench seed": "barry-cache bench seed [--write] [--json]",
```

Add a line to `usageText` (after the `resume` line):

```ts
  barry-cache bench run [--budget N] [--json]
  barry-cache bench seed [--write] [--json]
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/benchmark-run.test.ts && bun run typecheck`
Expected: PASS — 3 pass. (Typecheck passes only after Task 7 adds `seedBenchmarkTasks`/`writeSeededTasks`; if running strictly task-by-task, scope the import as noted above and stub `handleBenchSeedCommand` to throw `CliArgumentError("bench seed not yet implemented")`.)

---

### Task 7: Benchmark seeder + `bench seed` command

**Files:**
- Modify: `src/core/validate.ts` (export `readIdmapTokens` — change `async function readIdmapTokens` at `src/core/validate.ts:101` to `export async function readIdmapTokens`)
- Modify: `src/core/benchmark.ts` (add `seedBenchmarkTasks`, `writeSeededTasks`)
- Modify: `src/cli.ts` (add `handleBenchSeedCommand`; finalize seed imports from Task 6)
- Test: `tests/benchmark-seed.test.ts`

**Interfaces:**
- Consumes: `readIdmapTokens` from `./validate`; `readContextSnapshot` from `./context-cache`; `readTextIfExists`, `repoPath`, `writeText` from `./fs`.
- Produces:
  - `async function seedBenchmarkTasks(opts: { repo: string }): Promise<{ candidates: BenchmarkTask[]; skipped: number }>`
  - `async function writeSeededTasks(opts: { repo: string; candidates: BenchmarkTask[] }): Promise<{ written: number; path: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/benchmark-seed.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { seedBenchmarkTasks, writeSeededTasks } from "../src/core/benchmark";
import { finalizeProject } from "../src/core/context";
import { withTempRepo } from "./helpers";

async function addPack(repo: string): Promise<void> {
  const dir = join(repo, "docs/context/features/renderer");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# renderer\n\nrenderer summary.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `F01`: src/runtime/clock.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  await writeFile(join(dir, "FACTS.jsonl"), JSON.stringify({
    id: "REN0", subject: "S", predicate: "p", object: "clock",
    src: ["F01"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
  }) + "\n");
}

describe("benchmark seed", () => {
  test("infers expect_packs from handoff files via IDMAP", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo);
      await finalizeProject({
        repo, status: "success", summary: "Fixed renderer clock drift",
        files: ["src/runtime/clock.ts"],
      });
      const { candidates } = await seedBenchmarkTasks({ repo });
      expect(candidates[0]?.task).toBe("Fixed renderer clock drift");
      expect(candidates[0]?.expect_packs).toContain("renderer");
    });
  });

  test("write appends new rows and dedupes by task", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo);
      await finalizeProject({ repo, status: "success", summary: "Fixed renderer clock drift", files: ["src/runtime/clock.ts"] });
      const first = await seedBenchmarkTasks({ repo });
      const w1 = await writeSeededTasks({ repo, candidates: first.candidates });
      expect(w1.written).toBe(1);
      const second = await seedBenchmarkTasks({ repo });
      const w2 = await writeSeededTasks({ repo, candidates: second.candidates });
      expect(w2.written).toBe(0); // already present => deduped
      const content = await readFile(join(repo, "docs/context/benchmarks/tasks.jsonl"), "utf8");
      expect(content.trim().split(/\n/)).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/benchmark-seed.test.ts`
Expected: FAIL — `seedBenchmarkTasks`/`writeSeededTasks` not exported.

- [ ] **Step 3: Export `readIdmapTokens`**

In `src/core/validate.ts:101`, change:

```ts
async function readIdmapTokens(path: string): Promise<Map<string, string>> {
```
to:
```ts
export async function readIdmapTokens(path: string): Promise<Map<string, string>> {
```

- [ ] **Step 4: Implement the seeder in `src/core/benchmark.ts`**

Add imports at the top of `benchmark.ts`:

```ts
import { join } from "node:path";
import { writeText } from "./fs";
import { readIdmapTokens } from "./validate";
```

Append:

```ts
interface HandoffRecord {
  summary?: string;
  files?: string[];
}

export async function seedBenchmarkTasks({ repo }: { repo: string }): Promise<{ candidates: BenchmarkTask[]; skipped: number }> {
  const featurePaths = await buildFeaturePaths(repo);
  const handoffs = await readHandoffs(repo);
  const existing = new Set((await readBenchmarkTasks(repo)).tasks.map((task) => normalize(task.task)));

  const candidates: BenchmarkTask[] = [];
  const seenTasks = new Set<string>(existing);
  let skipped = 0;
  let index = 0;

  for (const handoff of handoffs) {
    const summary = (handoff.summary ?? "").trim();
    if (summary.length === 0) continue;
    const key = normalize(summary);
    if (seenTasks.has(key)) continue;

    const packs = inferPacks(handoff.files ?? [], featurePaths);
    if (packs.length === 0) {
      skipped++;
      continue;
    }
    seenTasks.add(key);
    candidates.push({ id: `SEED-${String(++index).padStart(3, "0")}`, task: summary, expect_packs: packs });
  }
  return { candidates, skipped };
}

export async function writeSeededTasks({ repo, candidates }: { repo: string; candidates: BenchmarkTask[] }): Promise<{ written: number; path: string }> {
  const rel = "docs/context/benchmarks/tasks.jsonl";
  const path = repoPath(repo, rel);
  const existing = (await readBenchmarkTasks(repo)).tasks;
  const seen = new Set(existing.map((task) => normalize(task.task)));
  const fresh = candidates.filter((task) => !seen.has(normalize(task.task)));
  if (fresh.length === 0) return { written: 0, path: rel };
  const prior = await readTextIfExists(path);
  const prefix = prior.length > 0 && !prior.endsWith("\n") ? `${prior}\n` : prior;
  const appended = fresh.map((task) => JSON.stringify(task)).join("\n") + "\n";
  await writeText(path, prefix + appended);
  return { written: fresh.length, path: rel };
}

async function buildFeaturePaths(repo: string): Promise<Map<string, Set<string>>> {
  const { features } = await readContextSnapshot(repo);
  const map = new Map<string, Set<string>>();
  for (const feature of features) {
    const paths = new Set<string>();
    const idmap = await readIdmapTokens(join(feature.dir, "IDMAP.md"));
    for (const value of idmap.values()) paths.add(normalizePath(value));
    map.set(feature.slug, paths);
  }
  return map;
}

function inferPacks(files: string[], featurePaths: Map<string, Set<string>>): string[] {
  const slugs = new Set<string>();
  for (const file of files) {
    const norm = normalizePath(file);
    for (const [slug, paths] of featurePaths) {
      if (paths.has(norm)) slugs.add(slug);
      if (norm.startsWith(`docs/context/features/${slug}/`)) slugs.add(slug);
    }
  }
  return [...slugs].sort();
}

async function readHandoffs(repo: string): Promise<HandoffRecord[]> {
  const text = await readTextIfExists(repoPath(repo, ".context-state/handoffs/handoffs.jsonl"));
  const records: HandoffRecord[] = [];
  for (const row of text.split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    try {
      records.push(JSON.parse(row) as HandoffRecord);
    } catch {
      // skip malformed handoff rows
    }
  }
  return records;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}
```

- [ ] **Step 5: Implement `handleBenchSeedCommand` in `src/cli.ts`**

Ensure the Task 6 import now includes `seedBenchmarkTasks, writeSeededTasks`. Add:

```ts
async function handleBenchSeedCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const { candidates, skipped } = await seedBenchmarkTasks({ repo });
  const write = parsed.flags.get("write") === true;
  if (write) {
    const result = await writeSeededTasks({ repo, candidates });
    print({ written: result.written, path: result.path, skipped }, json,
      `Appended ${result.written} benchmark fixture(s) to ${result.path}.${skipped ? ` Skipped ${skipped} handoff(s) with no inferable pack.` : ""}`);
    return;
  }
  if (json) {
    print({ candidates, skipped }, true);
    return;
  }
  if (candidates.length === 0) {
    console.log("No new benchmark fixtures to seed. Finalize a task first, or all handoffs are already covered.");
    return;
  }
  for (const candidate of candidates) console.log(JSON.stringify(candidate));
  console.log(`\nReview the rows above, then run \`barry-cache bench seed --write\` to append them.`);
}
```

- [ ] **Step 6: Run tests**

Run: `bun test tests/benchmark-seed.test.ts tests/benchmark-run.test.ts && bun run typecheck`
Expected: PASS — seed 2 pass, run 3 pass, typecheck clean.

---

### Task 8: Decision record (ADR + fact) for the new architecture

**Files:**
- Create: `docs/context/adrs/ADR-0015-add-budget-aware-loading-and-benchmark-harness.md` (via CLI)
- Create: `docs/context/features/context-loading/{README.md,IDMAP.md,KG.adj,FACTS.jsonl}` (new feature pack documenting this behavior) OR append to an existing relevant pack
- Test: validation (`bun run barry -- validate`)

**Interfaces:**
- Produces: an ADR file + a `kind: "decision"` fact whose `src` points at the ADR, satisfying `CLAUDE.md`'s decision-record policy.

- [ ] **Step 1: Create the ADR**

Run: `bun run barry -- adr new --title "Add budget-aware loading and benchmark harness" --tags context,loading,benchmark`
Expected: prints `Created ADR-00NN at docs/context/adrs/ADR-00NN-...md` (note the assigned id).

- [ ] **Step 2: Fill the ADR body**

Edit the created ADR file: under its sections, record the decision verbatim from the spec — context (routing-only token reduction), decision (opt-in lossless budget selection + CCR-style expand + structural benchmark; Approach A, B deferred and gated on benchmark results), and consequences (no new deps, backward compatible, lossless invariant).

- [ ] **Step 3: Create a context pack documenting the behavior**

Run: `bun run barry -- feature new --slug context-loading --title "Context Loading" --summary "Budget-aware lossless loading and the benchmark harness."`
Expected: prints `Created feature pack context-loading.`

- [ ] **Step 4: Add an IDMAP + decision fact**

Edit `docs/context/features/context-loading/IDMAP.md` to add the source ids:

```markdown
# ID Map

- `BUDGET`: src/core/budget.ts
- `TOKENS`: src/core/tokens.ts
- `BENCH`: src/core/benchmark.ts
```

Append two facts to `docs/context/features/context-loading/FACTS.jsonl` (use a real ISO timestamp and the ADR id assigned in Step 1):

```jsonl
{"id":"LOAD-20260623T120000Z-a1b2","subject":"load and resume","predicate":"select context within","object":"an optional --budget using lossless relevance-ranked facts with --expand restore","src":["BUDGET","TOKENS"],"status":"active","kind":"implemented","updated_at":"2026-06-23T12:00:00.000Z","confidence":"high","tags":["loading","budget"]}
{"id":"LOAD-20260623T120100Z-c3d4","subject":"Barry","predicate":"adopts","object":"opt-in budget-aware loading plus a structural benchmark; the general pipeline (Approach B) is deferred until benchmarks justify it","src":["docs/context/adrs/ADR-00NN-add-budget-aware-loading-and-benchmark-harness.md"],"status":"active","kind":"decision","updated_at":"2026-06-23T12:01:00.000Z","confidence":"high","tags":["loading","decision"]}
```

Add a KG row to `docs/context/features/context-loading/KG.adj`:

```
load uses budget
```

- [ ] **Step 5: Validate**

Run: `bun run barry -- validate`
Expected: `Barry Cache context is valid.` (Fix any reported errors — e.g. unknown source id, ADR id mismatch — before proceeding.)

---

### Task 9: Final integration, README, and single commit

**Files:**
- Modify: `README.md` (document `--budget`/`--expand` on `load`/`resume`, and the `bench` command in the command table)
- Verify: full suite, typecheck, build

- [ ] **Step 1: Update the README command table**

Add rows to the command table in `README.md` (after the `load` row and near `validate`):

```markdown
| `load --route <name> [--budget N] [--expand <id|all>]` | Load one feature pack; with `--budget`, return a lossless relevance-ranked slice within the token budget and list dropped ids to `--expand`. |
| `bench run [--budget N]` | Run benchmark fixtures: report tokens saved and pack/fact recall. |
| `bench seed [--write]` | Draft benchmark fixtures from recorded handoffs (review, then `--write`). |
```

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS — all suites green (including the new `tokens`, `budget`, `cli-load-budget`, `resume-budget`, `benchmark-validate`, `benchmark-run`, `benchmark-seed`, and the pre-existing `context-flow`, `cli-validate`, `cli-help`).

- [ ] **Step 3: Typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: no type errors; build writes `dist/` without error.

- [ ] **Step 4: Run Barry's own validation + a live smoke test**

Run: `bun run barry -- validate && bun run barry -- bench seed && bun run barry -- load --route context-loading --budget 300`
Expected: validation passes; `bench seed` prints draft rows (or a "no new fixtures" message); `load --budget 300` prints a budgeted pack JSON with a `budget` block whose `used <= 300` (unless a forced expand overflows).

- [ ] **Step 5: Create the branch and commit (single commit at the end)**

```bash
git checkout -b feat/budget-aware-loading-and-benchmarks
git add -A
git commit -m "$(cat <<'EOF'
feat: add budget-aware lossless loading and a structural benchmark harness

Adds opt-in --budget/--expand to load and resume (relevance-ranked, lossless,
CCR-style expansion) and a deterministic `bench` harness (tokens saved + pack/
fact recall) with a handoff seeder. Approach A; the general pipeline (B) is
deferred and gated on benchmark results. Inspired by Headroom, adapted to
Barry's lossless, auditable, dependency-light model.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: a single commit on the new branch. Do NOT push unless asked.

---

## Self-Review

**1. Spec coverage:**
- TokenCounter (pluggable, heuristic default) → Task 1. ✓
- Budget-aware loading: ranking, fill, ADR summary, dropped list, expand, lossless invariant → Task 2 + Task 3. ✓
- `resume --budget` → Task 4. ✓
- Backward compatibility (no `--budget` == today) → Task 3 (raw load path) + Task 4 (no `context_preview`) + Task 9 (`context-flow` stays green). ✓
- Benchmark fixtures + schema + validate → Task 5. ✓
- `bench run` (tokens saved, pack/fact recall, overflow, corpus baseline, regressions) → Task 6. ✓
- `bench seed` (handoff inference via IDMAP, dedup, `--write`) → Task 7. ✓
- ADR + decision fact → Task 8. ✓
- Error handling (budget too small → core + overflow; unknown expand id → ignored; missing fixtures → friendly message; malformed fixture → validate flags / run skips) → covered across Tasks 2/5/6 and tested. ✓
- Determinism (stable tie-breakers, no wall-clock in ranking) → Task 2. ✓

**2. Placeholder scan:** No "TBD"/"TODO"/"add error handling" placeholders. ADR id is intentionally `ADR-00NN` because the number is assigned at creation time in Task 8 Step 1 (instruction tells the implementer to substitute it). The benchmark `bench` import note in Task 6 explicitly handles the cross-task ordering.

**3. Type consistency:** `budgetContext` signature and `BudgetedContext`/`BudgetReport`/`DroppedItem`/`BudgetedAdr` are defined once in Task 2 and consumed unchanged in Tasks 3/4/6. `BenchmarkTask`/`BenchmarkReport`/`BenchmarkTaskResult` defined in Task 6 and reused in Task 7. `readIdmapTokens` exported in Task 7 matches its `src/core/validate.ts:101` definition. `optionalPositiveInt` defined once in Task 3 and reused in Tasks 4/6. CLI `main` exported in Task 3 for any direct-invocation tests.

## Known cross-task ordering note

Task 6 imports `seedBenchmarkTasks`/`writeSeededTasks` that only exist after Task 7. If executing strictly one task at a time with a typecheck gate, follow the inline note in Task 6 Step 4 (scope the import and stub `handleBenchSeedCommand`), then complete it in Task 7 Step 5. If implementing Tasks 6 and 7 back-to-back, import everything in Task 6 and the typecheck passes at the end of Task 7.
