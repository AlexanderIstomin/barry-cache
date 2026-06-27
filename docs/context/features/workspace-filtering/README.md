# Workspace Filtering

Owns optional workspace-scoped context routing, workspace selection decisions, and agent guidance for large multi-module repositories.

## Scope

Workspace filtering is an optional routing layer over canonical feature packs. Repos
that need it add `docs/context/workspaces.json`; repos without that file keep the
existing global route/search/resume behavior.

Agents can pass explicit `--workspace` or known `--paths`. Barry reports a
`workspace_decision` with status, source, evidence, dependencies, and required action
when ambiguous.

## Sources

- `src/core/workspaces.ts` — registry parsing, inference, route/dependency helpers, validation (`WORKSPACES`)
- `src/core/context.ts` — route/search/resume workspace boosts and decision output (`CONTEXT`)
- `src/core/validate.ts` — workspace registry validation integration (`VALIDATE`)
- `src/core/context-cache.ts` — cache manifest invalidation for workspace registry/schema (`CACHE`)
- `src/cli.ts` — CLI flags and `workspace` command (`CLI`)
- `src/core/templates.ts` — generated agent guidance and workspace schema (`TEMPLATE`)
- `src/core/init.ts` — generated workspace schema file (`INIT`)
