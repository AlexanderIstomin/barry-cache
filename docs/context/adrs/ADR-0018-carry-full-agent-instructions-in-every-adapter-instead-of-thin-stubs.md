---
id: ADR-0018
title: Carry full agent instructions in every adapter instead of thin stubs
status: active
date: 2026-07-03
supersedes: [ADR-0012]
tags: [agents, adapters, init, agents-md, memory]
---

# ADR-0018: Carry full agent instructions in every adapter instead of thin stubs

## Context

ADR-0012 made `AGENTS.md` the single canonical instruction file and reduced the other
adapters (`CLAUDE.md`, `GEMINI.md`, copilot, cursor) to **thin stubs** (`agentStub()`) that
name the entry command and point to `AGENTS.md` for the write-side memory policy and
decision-record rules.

In practice that pointer was not reliably followed: agents reading only a vendor adapter
frequently skipped the write-side policy (the "agents laziness" that #7 first tried to fix by
fattening the stub with the retrieval loop). A stub that carries the day-to-day retrieval loop
but defers the memory policy still leaves the most consequential guidance — what goes to shared
Barry context vs. an agent's private memory — one dereference away, and agents kept missing it.

## Decision

Every non-Codex adapter now carries the **full** instructions inside its managed block, identical
to `AGENTS.md`: retrieval loop, the private-vs-shared memory policy (including `feedback`-type
routing), Shared KB (cq) guidance, and decision-record rules. `agentStub()` is removed; `init`
renders `agentInstructions()` into `AGENTS.md` and into each adapter file. `llms.txt` stays a
small content index.

`--agents` semantics are unchanged from ADR-0012: selecting any instruction adapter still implies
writing `AGENTS.md`, and adapters are still applied as managed blocks so they compose with existing
user content.

## Consequences

The policy text is duplicated across adapters again, but it is generated from one source
(`agentInstructions()` in `templates.ts`), so the files cannot drift — the duplication is a build
artifact, not a maintenance burden. The trade-off ADR-0012 accepted (a single canonical file, less
duplication) is reversed in favor of every agent seeing the write-side policy without following a
pointer. This supersedes ADR-0012. Relates to ADR-0002 (ADR guidance in generated instructions),
which still holds — that guidance now lives in every adapter rather than only `AGENTS.md`. Facts
describing adapter generation should reference this ADR.
