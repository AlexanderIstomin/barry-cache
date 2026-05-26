---
id: ADR-0002
title: Include ADR guidance in generated agent instructions
status: active
date: 2026-05-26
supersedes: []
tags: [agents, adr, protocol]
---

# ADR-0002: Include ADR guidance in generated agent instructions

## Context

Barry Cache already supports ADR creation and documents ADR maintenance in `docs/context/MAINTENANCE.md`. However, generated agent-facing instruction files are the first thing coding agents are likely to read, and those instructions previously described routing, validation, finalization, and memory policy without explaining when to create an ADR.

That made ADR use depend on the user mentioning ADRs explicitly or on the agent discovering maintenance docs. For architectural changes, repo policy changes, storage layout changes, agent protocol changes, and cross-module behavior changes, that is too easy to miss.

## Decision

Generated Barry agent instructions include a concise `Decision records` section. The section tells agents:

- When an ADR is appropriate.
- Which `barry-cache adr new` command to run through the detected repo command prefix.
- How to link the ADR from a `kind: "decision"` fact.
- When not to create an ADR.

The wording is criteria-based rather than automatic. Barry should guide agents to create ADRs for durable decisions while avoiding noise for routine bug fixes, local refactors, temporary notes, and uncertain ideas.

## Consequences

Agents that follow generated Barry instructions can preserve architectural reasoning without needing a separate user reminder. Generated adapter files stay short, but they now include enough ADR policy to make ADR use discoverable.

This does not make ADRs automatic during `finalize`; the decision to create an ADR remains explicit because automatic ADR generation would likely produce low-signal records.
