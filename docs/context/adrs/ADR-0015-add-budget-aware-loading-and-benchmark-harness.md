---
id: ADR-0015
title: Add budget-aware loading and benchmark harness
status: active
date: 2026-06-23
supersedes: []
tags: [context, loading, benchmark]
---

# ADR-0015: Add budget-aware loading and benchmark harness

## Context

Barry reduces an agent's context cost only by routing — loading fewer feature
packs. Once a pack is selected, `load`/`resume` emit the whole thing (full README/
IDMAP/KG prose, every fact, full linked ADR text), so a pack cannot be fit to a
token budget, and there is no way to measure whether routing/loading actually saves
tokens without dropping anything important. Headroom demonstrates large savings by
compressing what reaches the model, but its core compression is ML/lossy and off
Barry's stack and philosophy (exact, auditable, dependency-light).

## Decision

Add opt-in, **lossless** budget-aware loading plus a deterministic structural
benchmark (Approach A):

- `load`/`resume` accept `--budget N`. Within the budget, Barry emits a
  relevance-ranked, terse slice (core summary + ranked facts + ADR summaries) and
  reports dropped ids; `--expand <ID|all>` restores any of it. Nothing is deleted —
  every item stays on disk and addressable, so the operation is lossless and
  reversible. The CLI applies a default budget of **2000 tokens/pack**
  (`DEFAULT_LOAD_BUDGET`, the benchmarked full-recall knee on Barry's own packs —
  `bench run`: ~100% fact recall, 0 regressions). Selection trims the lowest-ranked
  items until the **full emitted output** fits the budget; forced `--expand` items
  and the core summary may still exceed it. `load --expand all` returns the full
  pack; lower `--budget` to trade recall for savings. The underlying
  `budgetContext`/`resumeProject` library API stays opt-in
  (no budget → full), so the default is a CLI policy, not a mechanism change.
- `loadContext` carries facts once (top-level) instead of duplicating them under
  `feature`, shrinking raw `load` output ≈43% on Barry's own context independent of
  budgeting.
- Token counting is a zero-dependency heuristic behind a `TokenCounter` interface
  (seam for a real BPE tokenizer later).
- A `bench` harness (`run`/`seed`) measures tokens saved vs. a full-context baseline
  and pack/fact recall over `docs/context/benchmarks/tasks.jsonl`. No model calls.

The general "context-fitting" pipeline (Approach B) and a real BPE tokenizer are
**deferred** and gated on what these benchmarks show.

## Consequences

- No new runtime dependencies. The library API stays backward compatible
  (budgeting opt-in at the module level); the CLI defaults to budgeting at 2000/pack,
  so default `load`/`resume` output now favors a budgeted slice over the full pack.
- The lossless invariant (dropped items remain on disk, restorable via `--expand`)
  is enforced by tests.
- The benchmark is the instrument that justifies (or rejects) future work on
  Approach B. Facts in `docs/context/features/context-loading/FACTS.jsonl` reference
  this ADR.
