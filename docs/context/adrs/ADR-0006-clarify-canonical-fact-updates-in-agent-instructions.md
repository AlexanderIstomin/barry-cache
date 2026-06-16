---
id: ADR-0006
title: Clarify canonical fact updates in agent instructions
status: superseded
date: 2026-06-02
supersedes: []
tags: [init, agents, context]
---

# ADR-0006: Clarify canonical fact updates in agent instructions

## Context

Barry Cache separates operational memory from canonical source-backed facts. The `finalize` and `failure record` commands write `.context-state/` records, while durable implementation facts live in `docs/context/features/*/FACTS.jsonl`.

Some coding agents infer that a repository memory system should expose a `fact` CLI subcommand, then spend time trying to find or invent one. That mistake is costly because it can lead agents to treat operational handoffs as canonical facts or to skip the direct `FACTS.jsonl` update required for durable behavior changes.

## Decision

Generated Barry agent instructions and context maintenance guidance will explicitly state that there is no `fact` CLI command. They will tell agents to update canonical facts by editing `docs/context/features/*/FACTS.jsonl` directly and then running validation through the repo's Barry command prefix.

## Consequences

Agents get a direct correction at the point where they choose between CLI commands and source-backed fact edits. This adds one line to generated adapter text, but the extra specificity is worth the reduced chance of agents confusing operational memory with canonical project context.

The instruction does not add a fact-writing CLI. Barry keeps canonical facts reviewable as source files.
