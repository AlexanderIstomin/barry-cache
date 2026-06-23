# Budget-aware loading + structural benchmark harness

- Date: 2026-06-23
- Status: approved (design); see **Amendment** for decisions that evolved during implementation.
- Inspiration: Headroom (`headroomlabs-ai/headroom`) — adapted to Barry's lossless, auditable, dependency-light philosophy.

> **Amendment (shipped behavior).** Two decisions evolved from this spec during
> implementation; ADR-0015 is the canonical record:
> 1. The **CLI makes budgeting default-on at 1500 tokens/pack** (`DEFAULT_LOAD_BUDGET`),
>    with `load --expand all` as the full-pack escape hatch. The library API
>    (`budgetContext`/`resumeProject`) stays opt-in, so the default is a CLI policy.
> 2. `loadContext` **deduplicates facts** — carried once at the top level, not also
>    under `feature` — shrinking raw `load` output ~43% on Barry's own context.
>
> Also: `DEFAULT_BENCH_BUDGET` shipped as **1500** (not 2000), aligned to the
> benchmarked recall/savings knee.

## Context

Barry reduces an agent's context cost only by **routing** — loading fewer feature
packs. Once a pack is selected, `loadContext` emits the whole thing: full README /
IDMAP / KG prose, **every** fact row, and **full linked ADR text** (see
`src/core/context.ts` `loadContext`). There is no way to fit a pack into a token
budget, and Barry cannot measure whether routing/loading actually saves tokens
without dropping anything important.

Headroom attacks the second axis — it compresses the bytes that reach the model.
Its core compression is ML/lossy and Python+Rust; that is off-stack and off-
philosophy for Barry. The on-philosophy adaptation is **lossless, budget-aware
selection with on-demand expansion** (every dropped item stays on disk and is
addressable by ID), plus a **deterministic benchmark** that proves the savings and
guards recall.

## Goals

1. `load` / `resume` accept an optional `--budget N`. Within the budget, Barry emits
   a relevance-ranked, terse slice of the pack and reports what it dropped, with a
   CCR-style `--expand <ID|all>` to restore any dropped detail. Lossless: nothing is
   deleted; selection only.
2. A deterministic `bench` harness measures tokens saved vs. a full-context baseline
   and recall (did routing + budgeting still surface the expected packs/facts?). No
   API keys, no model calls — reproducible in CI.
3. Backward compatible at the library level: `budgetContext`/`resumeProject` stay
   opt-in (no budget → full). **As shipped, the CLI defaults to budgeting at 1500
   tokens/pack; `load --expand all` returns the full pack** (see Amendment).

## Non-goals (deferred)

- **Approach B** — a general "context-fitting" pipeline layer that all retrieval
  passes through. Deferred by explicit decision: build A first, then use the
  benchmark to decide whether B is justified.
- ML / lossy compression (Headroom's Kompress-base). Barry stays lossless.
- LLM-in-the-loop accuracy evals (GSM8K-style). Out of scope; benchmark is structural.
- MCP server surface; automated failure mining (`headroom learn` analog).

## Decision: A now, B later (gated)

Approach A is the minimal, reviewable change that delivers budget-aware lossless
loading plus the measurement instrument. The benchmark measures exactly what B would
improve (token savings + recall), so its output is the gate for ever doing B. We do
not refactor toward B speculatively (YAGNI).

## Components

### 1. TokenCounter — `src/core/tokens.ts`

```ts
export interface TokenCounter { count(text: string): number }
export const heuristicCounter: TokenCounter;        // v1: Math.ceil(text.length / 4)
export function getCounter(name?: string): TokenCounter; // default heuristic; seam for a real tokenizer
```

- Deterministic, zero new runtime dependencies.
- Approximate by design — budgets are coarse guidance. The interface is the seam: a
  real BPE tokenizer can be added later behind `getCounter("gpt")` without changing
  callers.

### 2. Budget-aware loading — `src/core/budget.ts`

A pure module: given a `FeaturePack`, the linked ADRs, the task tokens, a budget, and
a `TokenCounter`, it returns a `BudgetedPack` (what to render + what was dropped).
`loadContext` and the CLI renderer consume it; with no budget the module is bypassed.

**Ranking (facts):**
1. Primary key: lexical relevance — reuse `scoreText(factToText(fact), taskTokens)`.
2. Exclude `status` ∈ {`superseded`, `deprecated`} from default selection (still on
   disk; expandable).
3. Tie-break by **kind weight** (prefer-to-keep, higher first), default starting weights:
   `decision = 5`, `constraint = 5`, `risk = 4`, `implemented = 3`, `test = 2`,
   `open-question = 2`. Relevance dominates; kind only orders ties. These weights are
   a starting point the benchmark can tune.
4. Then `confidence` (high > medium > low), then `updated_at` descending, then `id`
   ascending — fully deterministic, no wall-clock input.

**Fill:**
- Always include a small **core**: feature title + README first paragraph + the
  execution contract (resume). Core is tiny and included even if it exceeds budget —
  we never silently drop core; we report overflow honestly.
- Then greedily add ranked facts while `used + count(next) <= budget`.
- **Linked ADRs:** render as `title + summary line` by default (full body only via
  expand). ADR prose is the largest token sink.
- **IDMAP / KG:** referenced as file paths (the way `sources` already are) when a
  budget is set, instead of inlined; restored via expand.

**Report + expand:**
- Emit `dropped (N): ID1, ID2 …` plus hint: `barry load --route X --expand <ID|all>`.
- `--expand <ID>` force-includes that fact/ADR at full detail (budget ignored for
  forced items). `--expand all` reproduces today's full output.
- Unknown `--expand` ID → warn and ignore (non-fatal).

**Output:** works for text and `--json`. JSON gains a `budget` block:
`{ budget, used, baseline_tokens, saved_pct, overflow, dropped: [...ids], expand_hint }`
— `used` is the cost of the **entire** emitted object (content + sources + this
report), and `dropped` is a compact list of ids (the included ids are already on the
returned `facts`). (See Amendment.)

**Lossless invariant (asserted by tests):** every dropped ID is present on disk and
retrievable via `--expand`. Budgeting never mutates `docs/context/`.

### 3. Benchmark harness — `src/core/benchmark.ts`

**Fixtures:** `docs/context/benchmarks/tasks.jsonl`, one row per task:
```json
{ "id": "B001", "task": "audit what the review server serves",
  "expect_packs": ["review-interface"], "expect_facts": ["REV001"], "budget": 2000 }
```
- `expect_facts` and `budget` optional. Schema: `docs/context/schema/benchmark-task.schema.json`.
- `validate` checks each row against the schema **when the file exists** (absence is
  not an error).

**`bench run [--budget N] [--json]`** — for each fixture:
1. `routeTask(task)` → routed packs.
2. `loadContext` for routed packs; apply budget (precedence: `--budget` flag >
   `fixture.budget` > `DEFAULT_BENCH_BUDGET` = 1500).
3. Metrics:
   - `baseline_tokens` — unbudgeted routed packs (full render).
   - `loaded_tokens` — after budgeting.
   - `tokens_saved_pct` = `1 - loaded/baseline`.
   - `pack_recall` = `|expect_packs ∩ routed_packs| / |expect_packs|`.
   - `fact_recall` = fraction of `expect_facts` present in the included set.
   - `budget_overflow` = `max(0, loaded_tokens - budget)`.
4. Aggregate: mean `tokens_saved_pct`, mean `pack_recall`, mean `fact_recall`, count
   of tasks with recall < 1 (regressions), and a corpus-baseline headline
   ("loads X% of full context corpus" = routed+budgeted tokens / all-packs tokens).
5. Output: human table + `--json`.

**`bench seed [--write] [--json]`** — drafts fixtures from `.context-state/handoffs`:
- For each handoff: `task = summary`; `expect_packs` = feature slugs whose pack owns
  any file in `handoff.files`. Ownership = a pack fact's `src` IDMAP code resolves to
  that file path (reuse existing IDMAP→path resolution used by drift detection);
  fallback to feature-dir path prefix.
- Dedup candidates by normalized task text against existing fixtures.
- Default prints JSONL drafts for review; `--write` appends only new rows. Never
  overwrites or rewrites existing rows — a guardrail like `fact draft`.

## CLI surface

- `load --route X [--budget N] [--expand <ID|all>]`
- `resume --task "…" [--budget N]`
- `bench run [--budget N] [--json]`
- `bench seed [--write] [--json]`

## Error handling

- Budget too small for core → emit core, set `budget_overflow > 0`, report it. Never
  silently drop core content.
- Unknown `--expand` ID → warn, ignore, continue.
- Missing `tasks.jsonl` on `bench run` → friendly message ("no fixtures; run
  `barry bench seed` or create docs/context/benchmarks/tasks.jsonl"), exit 0.
- Malformed fixture row → `validate` flags it; `bench run` skips it with a warning.
- Determinism everywhere: stable tie-breakers; no `Date.now()` in ranking or metrics.

## Testing strategy

- **tokens:** heuristic counts; empty/whitespace; monotonicity.
- **budget:** ranking order (relevance then kind/confidence/recency/id); fill
  boundaries (under / exactly at / over budget); ADR summary-vs-full; expand by ID and
  `all`; unknown-ID warning; dropped-list correctness.
- **lossless invariant:** every dropped ID is expandable; `docs/context/` unchanged.
- **backward-compat snapshot:** `load`/`resume` with no `--budget` == current output.
- **benchmark:** metric math on a tiny fixture set; `pack_recall`/`fact_recall`;
  `budget_overflow`; seeder file→pack mapping incl. IDMAP resolution + fallback;
  missing-fixtures handling; dedup on `--write`.

## ADR + fact

This adds durable architecture (a new loading mode, the `docs/context/benchmarks/`
storage location, and a new schema), so per `CLAUDE.md` it warrants:
- An ADR: "Add token-budget-aware lossless loading and a structural benchmark harness."
- A `kind: "decision"` fact whose `src` points at the ADR.

## Future (gated on benchmark results)

If `bench run` shows budgeting saves materially without hurting recall, evaluate
Approach B (the context-fitting pipeline) and, separately, a real BPE tokenizer
behind `getCounter`.
