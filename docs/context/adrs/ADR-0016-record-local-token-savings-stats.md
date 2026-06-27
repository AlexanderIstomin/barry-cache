---
id: ADR-0016
title: Record local token savings stats
status: active
date: 2026-06-26
supersedes: []
tags: [context, stats, telemetry]
---

# ADR-0016: Record local token savings stats

## Context

ADR-0015 added budget-aware `load`/`resume` output and a benchmark harness that
estimates savings against full-context baselines. That proves the mechanism in
fixtures, but users also need a simple way to see the operational value Barry is
providing during normal use.

The measurement cannot be presented as billing-grade accounting: Barry currently
uses a zero-dependency heuristic token counter, and actual model billing depends
on provider tokenization and surrounding prompt content. Stats must also avoid
becoming a telemetry or memory leak. Tasks and loaded context can contain private
project details, so a stats feature should store only compact numeric evidence.

## Decision

Record local operational stats for budgeted context-loading commands:

- Budgeted `load` and `resume` append compact events to
  `.context-state/stats/events.jsonl`.
- Each event stores the command, emitted route slug(s), budget, used tokens,
  baseline tokens, estimated tokens saved, dropped count, overflow, timestamp,
  schema version, and the `heuristic` counter name.
- Events do not store raw task text, loaded facts, ADR summaries, source prose, or
  any remote/user identity.
- `load --expand all` returns the full pack and does not record a budget-saving
  event, because no budgeted slice was emitted.
- `barry-cache stats [summary] [--since 7d|30d|all|YYYY-MM-DD]` aggregates the
  local events and labels the result as estimated heuristic savings; `summary`
  is a compatibility alias for the default stats report.

This stays in `.context-state/` because it is operational usage evidence, not
canonical project truth. Barry sends nothing remotely as part of stats.

## Consequences

- Users can see estimated saved tokens across real Barry usage, complementing
  `bench run` fixture measurements.
- The command remains deterministic and dependency-light, but the wording must
  stay explicit that counts are estimates.
- Corrupt stats rows are skipped so one bad operational row does not break Barry.
- Future work can add a provider-specific tokenizer or pricing projection behind
  the existing stats summary, but that should be a separate decision because it
  changes dependency and accuracy expectations.
