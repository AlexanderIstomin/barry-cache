---
id: ADR-0004
title: Record validation failures as operational contradictions
status: active
date: 2026-05-27
supersedes: []
tags: [context, validation, failures]
---

# ADR-0004: Record validation failures as operational contradictions

## Context

Barry handoffs record the outcome an agent believed it completed. They are useful for operational continuity, but they are not proof that the task actually worked after user validation.

When a user returns and says previously delivered work is wrong, replacing the old handoff would erase useful evidence. Recording only the eventual successful fix would also hide the stale assumption that caused the loop. Barry needs a way to preserve the contradiction, link it to the stale handoff or fact it challenges, and link later fixes back to that validation failure.

## Decision

Barry records user-reported validation failures as operational contradiction events under `.context-state/failures/failures.jsonl`.

Each validation failure stores:

- what failed (`summary`, `expected`, `actual`, `reporter`);
- when it was observed and last updated;
- status (`open`, `fixed`, or `wontfix`);
- touched files;
- `challenges` links to stale handoff IDs, fact IDs, or other records;
- `fixes` links when another failure or follow-up record resolves it.

The CLI exposes this as `barry-cache failure record`. `barry-cache finalize` accepts `--fixes` so a follow-up handoff can point back to the validation failure it resolved.

Generated agent instructions and maintenance docs tell agents to record the contradiction before or while fixing user-reported failed work. Source-backed facts still live in `docs/context/`; failure records remain operational memory.

## Consequences

Barry can reconcile stale assumptions without rewriting history. Review timelines can show both the failed validation and the later fix, including the challenged handoff or fact.

Failure records are not canonical implementation truth. If a contradiction changes durable behavior, agents must still update source-backed facts and validate `docs/context/`.

The operational IDs include timestamp and random suffixes so multiple handoffs or failures recorded in the same millisecond remain distinct.
