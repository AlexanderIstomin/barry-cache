---
id: ADR-0007
title: Add context authoring guardrails
status: active
date: 2026-06-16
supersedes: [ADR-0006]
tags: [context, cli, validation]
---

# ADR-0007: Add context authoring guardrails

## Context

Barry Cache originally made canonical fact updates fully manual. ADR-0006 explicitly told agents that there was no fact CLI command because operational memory commands such as `finalize` and `failure record` must not be confused with durable source-backed facts.

That protected the canonical `docs/context/` model, but it left common authoring mistakes to manual discipline: malformed fact fields, duplicate fact IDs, unresolved source IDs, empty feature scaffolds with inconsistent files, and agents hand-writing JSONL rows when a small guardrail could produce valid syntax.

The user feedback from Claude Code showed the tradeoff clearly. Manual edits are still the canonical model, but Barry should help agents draft and append valid source-backed records without becoming an opaque database or broad CRUD system.

## Decision

Barry adds context authoring guardrails while keeping source files as the source of truth:

- `barry-cache validate` checks more of the canonical context surface, including malformed ID map entries, malformed graph rows, duplicate fact IDs inside a feature pack, invalid fact enum/timestamp fields, and bare fact `src` IDs that do not resolve through the feature `IDMAP.md`.
- `barry-cache feature new` scaffolds the four canonical feature-pack files and refuses to overwrite an existing pack.
- `barry-cache fact draft` generates a schema-checked JSONL fact row. It prints the row by default and appends only when `--write` is explicit.
- Generated agent instructions describe `fact draft` as an authoring guardrail, not broad canonical CRUD. Direct `FACTS.jsonl` edits remain supported and all context edits still require validation.

## Consequences

Agents get safer defaults for repetitive context-authoring work without losing Git-reviewable source files. `fact draft` can reduce JSON syntax, ID, timestamp, and source-reference mistakes while still leaving humans and agents to review the resulting diff.

Barry now has a small `fact` command surface, so older guidance saying there is no fact CLI is superseded. The replacement policy is narrower: Barry provides draft/append guardrails, not arbitrary update/delete CRUD over canonical facts.

Future authoring helpers should follow the same shape: preview by default, require explicit write flags for canonical mutation, refuse ambiguous overwrites, and validate the resulting context.
