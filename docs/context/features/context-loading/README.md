# Context Loading

Budget-aware lossless loading and the benchmark harness.

## Scope

Default-on token-budget loading for `load` and `resume` (2000 tokens/pack;
`--budget N` resizes, `--expand <id|all>` restores dropped detail / the full pack),
the pluggable token counter, the `bench run`/`bench seed` harness that measures
token savings and pack/fact recall, and local operational `stats` reporting for
estimated savings from budgeted commands.

## Sources

- `src/core/budget.ts` — relevance-ranked, budget-bounded selection (`BUDGET`)
- `src/core/tokens.ts` — pluggable `TokenCounter`, heuristic default (`TOKENS`)
- `src/core/benchmark.ts` — fixtures, `runBenchmark`, seeder (`BENCH`)
- `src/core/stats.ts` — local token-savings event storage and summaries (`STATS`)
- `src/cli.ts` — command wiring for budgeted load/resume and stats reporting (`CLI`)

See [ADR-0015](../../adrs/ADR-0015-add-budget-aware-loading-and-benchmark-harness.md).
See [ADR-0016](../../adrs/ADR-0016-record-local-token-savings-stats.md).
