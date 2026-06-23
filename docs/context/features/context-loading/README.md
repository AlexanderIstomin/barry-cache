# Context Loading

Budget-aware lossless loading and the benchmark harness.

## Scope

Opt-in token-budget loading for `load` and `resume` (`--budget N`, `--expand
<ID|all>`), the pluggable token counter, and the `bench run`/`bench seed`
harness that measures token savings and pack/fact recall.

## Sources

- `src/core/budget.ts` — relevance-ranked, budget-bounded selection (`BUDGET`)
- `src/core/tokens.ts` — pluggable `TokenCounter`, heuristic default (`TOKENS`)
- `src/core/benchmark.ts` — fixtures, `runBenchmark`, seeder (`BENCH`)

See [ADR-0015](../../adrs/ADR-0015-add-budget-aware-loading-and-benchmark-harness.md).
