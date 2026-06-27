---
id: ADR-0017
title: Add optional workspace-scoped context filtering
status: active
date: 2026-06-27
supersedes: []
tags: [context, workspaces, agents]
---

# ADR-0017: Add optional workspace-scoped context filtering

## Context

Large multi-module repositories need more precise context retrieval than a single
global task-to-feature score can provide. Teams often work inside path-defined
services, packages, or apps, but Barry's canonical memory must remain one reviewed
source of truth in `docs/context/`; splitting canonical memory per workspace would
create drift and contradictory facts.

Agents also should not guess workspace boundaries. Barry can infer likely workspace
scope from explicit user input, touched paths, and task text, then report the
decision and evidence as part of `resume`, `route`, and `search`.

## Decision

Barry will support an optional `docs/context/workspaces.json` registry. The registry
maps workspace slugs to titles, aliases, owned paths, canonical feature routes, and
workspace dependencies. It is a routing and guidance layer over existing feature
packs, not a second memory store.

Workspace selection precedence is:

1. explicit `--workspace`;
2. path inference from `--paths`;
3. task-text inference from workspace slug/title/aliases/routes/paths;
4. no workspace.

When a workspace is selected, mapped routes receive a score boost and dependency
routes receive a smaller boost; unrelated global matches remain visible. When
selection is ambiguous under the default `require-when-ambiguous` mode, `resume`
returns a required action instead of a context preview so the agent asks the user or
reruns with `--workspace <slug>`.

## Consequences

This keeps Barry's single canonical context model intact while making large repos
more navigable. It adds a new optional source file, validation surface, cache
manifest entry, CLI flags, and generated agent instructions. The registry must be
validated so unknown routes, missing dependencies, malformed paths, and ambiguous
selection policy errors are visible during `barry-cache validate`.
