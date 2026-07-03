---
id: ADR-0012
title: Make AGENTS.md the canonical agent instruction file with thin stubs
status: superseded
superseded_by: ADR-0018
date: 2026-06-19
supersedes: []
tags: [agents, adapters, init, agents-md]
---

# ADR-0012: Make AGENTS.md the canonical agent instruction file with thin stubs

## Context

`init` generated near-duplicate copies of the same Barry instructions into six files
(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/barry-cache.mdc`,
`.github/copilot-instructions.md`, plus an `llms.txt` index). The full command set and memory
policy were maintained in two places (`agentInstructions()` for `AGENTS.md` and a separate
`adapterFile()` for the rest), so any change had to be mirrored and the per-vendor files drifted.

Meanwhile the ecosystem is converging on a single instruction-file standard: `AGENTS.md` was
donated to the Agentic AI Foundation (Linux Foundation), and the major agents increasingly read it.
Maintaining five full copies is redundant work that the standard is removing.

## Decision

`AGENTS.md` is the **single canonical** agent instruction file. It carries the full managed block
(`agentInstructions()` — commands, memory policy, ADR guidance). The other instruction adapters
(`CLAUDE.md`, `GEMINI.md`, copilot, cursor) become **thin stubs** written as managed blocks
(`agentStub()`) that name the repo entry command (`resume`) and point to `AGENTS.md` for the rest.
`llms.txt` remains a small content index.

Consequences for `init`:

- Selecting **any** instruction adapter implies writing `AGENTS.md` (it is the shared source the
  stubs depend on). `--agents codex` still writes only `AGENTS.md`; `--agents claude` now writes
  `AGENTS.md` + a `CLAUDE.md` stub.
- Stubs are applied as managed blocks (`<!-- barry-cache:start -->…<!-- barry-cache:end -->`), so
  they compose with existing user content instead of overwriting whole files.
- The duplicate `adapterFile()` generator is removed; there is now one instruction source.

The MCP-server/​client transport considered alongside this work is intentionally **out of scope**:
agents are more reliable and cheaper invoking the existing CLI, and the standard that eliminates
adapters is `AGENTS.md` convergence, not MCP.

## Consequences

One place to edit agent instructions; per-vendor files stop drifting and shrink to pointers that
can be dropped entirely as each vendor ships native `AGENTS.md` support. The trade-off is the
`--agents` semantic change (a vendor selection now also writes `AGENTS.md`) and a one-time content
change to regenerated `CLAUDE.md`/`GEMINI.md`/copilot/cursor files. Relates to ADR-0002 (ADR
guidance in generated instructions), which still holds — that guidance now lives once in
`AGENTS.md`. Facts describing the canonical-`AGENTS.md` + stub generation should reference this ADR.
