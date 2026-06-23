# Context Loading

Budget-aware lossless loading and the benchmark harness.

## Scope

Default-on token-budget loading for `load` and `resume` (1500 tokens/pack;
`--budget N` resizes, `--expand <id|all>` restores dropped detail / the full pack),
the pluggable token counter, and the `bench run`/`bench seed` harness that measures
token savings and pack/fact recall.

## Sources

- `src/core/budget.ts` — relevance-ranked, budget-bounded selection (`BUDGET`)
- `src/core/tokens.ts` — pluggable `TokenCounter`, heuristic default (`TOKENS`)
- `src/core/benchmark.ts` — fixtures, `runBenchmark`, seeder (`BENCH`)

See [ADR-0015](../../adrs/ADR-0015-add-budget-aware-loading-and-benchmark-harness.md).
