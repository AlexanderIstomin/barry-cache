# Barry Cache

<p align="center">
  <img src="https://raw.githubusercontent.com/AlexanderIstomin/barry-cache/main/assets/barry-cache.webp" alt="Barry Cache" width="420">
</p>

Barry Cache remembers your repo. It keeps source-backed project context in the repository, validates it, and gives coding agents a deterministic CLI for loading the smallest useful slice of that knowledge.

[Changelog](https://github.com/AlexanderIstomin/barry-cache/blob/main/CHANGELOG.md)

## Why

Coding agents need durable project context that is shared, reviewable, and smaller than the whole repo. Private assistant memory, ad-hoc chat history, and vendor-specific instruction files drift apart. Barry keeps one source of truth in the repo so every agent loads the same facts.

Three layers, by lifetime:

- `docs/context/` — **canonical** context: source-backed facts and ADRs, validated and reviewed in Git.
- `.context-state/` — **operational** continuity: session handoffs and failures (not canonical truth).
- `.context-cache/` — **disposable** parsed index, reused until a context source file changes.

That makes Barry agent-agnostic (adapters point to one canonical context), auditable (facts carry stable IDs and `src` references), and context-efficient (agents start from a routed slice, not the whole codebase).

## Quick start

```bash
npx barry-cache init
```

This bootstraps Barry in the current repo: it creates `docs/context/` with schemas, patches agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/barry-cache.mdc`, `.github/copilot-instructions.md`, `llms.txt`), adds npm scripts when a `package.json` exists, and writes a managed `.gitignore` block.

```bash
npx barry-cache init --agents codex   # only generate adapters you use (codex,cursor,copilot,claude,gemini,llms | all | none)
npx barry-cache init --yes            # non-interactive defaults
npx barry-cache init --dry-run        # preview writes without changing files
```

## How agents use it

Usually you don't run Barry yourself — `init` tells your agent to. Just ask normally ("Fix playback drift in the editor"), and the generated instructions have the agent run, before non-trivial work:

```bash
barry-cache resume --task "fix playback drift in the editor"
```

`resume` routes the task, picks the most relevant context packs, and returns a startup brief (first action, edit scope, validation commands). The agent then loads focused context and works:

```bash
barry-cache load --route editor-media-runtime
```

When a package manager is detected, the generated instructions call the repo script instead of assuming `barry-cache` is on `PATH` (e.g. `bun run barry -- resume --task "…"`). If an agent skips the protocol, prompt it: *"Before editing, run Barry's resume for this task, load the returned routes, do the work, then validate."*

At the end of a session the agent records what happened and promotes durable facts:

```bash
barry-cache finalize --status success --summary "Updated renderer clock context"
```

`finalize` writes **operational** memory only (a handoff in `.context-state/`). It does **not** change canonical context. If a task introduced durable behavior, add/update facts in `docs/context/features/*/FACTS.jsonl` and run `barry-cache validate`. When user validation contradicts earlier work, record it with `barry-cache failure record`.

## Commands

| Command | What it does |
|---|---|
| `init [--agents …] [--yes] [--dry-run]` | Create/refresh the context structure and agent adapters. |
| `resume --task "…"` | Startup brief for a task: routes + execution contract. |
| `route --task "…"` | Score feature packs against a task; return best routes. |
| `search --query "…"` | Search feature packs, facts, and ADRs. |
| `load --route <name>` | Load one feature pack (README, facts, linked ADRs, sources). |
| `finalize --status <s> --summary "…"` | Append an operational handoff (`success`/`partial`/`blocked`/`failed`). |
| `failure record --summary … --expected … --actual …` | Record a validation contradiction; link it with `--challenges`. |
| `validate` / `doctor` | Check context is structurally valid (required files, ADR frontmatter, every fact row). |
| `feature new --slug … --title … --summary …` | Scaffold a canonical feature context pack (refuses to overwrite). |
| `fact draft --route … [--prefix …] [--write]` | Print or append a schema-checked JSONL fact row (an authoring guardrail). |
| `adr new --title "…" [--tags …]` / `adr list` | Manage architecture decision records in `docs/context/adrs/`. |
| `review [--port N] [--open] [--json]` | Browser tool (or JSON export) to audit what Barry knows. |
| `changelog [--write\|--rewrite] [--since …]` | Generate a changelog from implemented timeline facts. |
| `import --source pulpcut-kb --from <path>` | Import an old PulpCut KB (`--dry-run --json` first). |
| `kb <sharing\|search\|propose\|harvest\|contribute>` | Shared knowledge base / cq interop — see below. |

Add `--json` to most commands for machine-readable output. In CI, run `barry-cache validate --strict` to also fail on context drift — facts whose `src` points at a missing file, or stale `open-question`/`risk` facts.

### Decisions and facts

Create an ADR when a decision changes durable architecture, then link it from a fact so the reasoning and the routable record stay connected:

```bash
barry-cache adr new --title "Use repo-native context" --tags context,agents
```

```json
{ "id": "CTX-0001", "subject": "Barry", "predicate": "stores canonical context in", "object": "docs/context/",
  "src": ["docs/context/adrs/ADR-0001-use-repo-native-context.md"], "status": "active", "kind": "decision", "updated_at": "2026-05-19" }
```

Use `fact draft` to generate or append a schema-checked fact row, or edit `docs/context/features/*/FACTS.jsonl` directly — then `validate`. `fact draft` is an authoring guardrail, not a broad CRUD interface for canonical context.

## Shared knowledge base (cq)

Barry interoperates with Mozilla's [cq](https://github.com/mozilla-ai/cq) — an open commons where coding agents share lessons — instead of running its own server. Barry keeps its lesson format canonical and talks to cq through a versioned adapter, so cross-agent knowledge is opt-in and never couples your repo to cq.

- **Consume:** `barry-cache kb search --source cq --query "…" --domains testing,ci` reads cq's commons (cq filters by `--domains`; the query then scores results locally).
- **Author locally:** `barry-cache kb harvest` drafts a sanitized lesson candidate from a finalize/failure record; `barry-cache kb propose lesson …` queues it to a repo-local outbox.
- **Contribute:** `barry-cache kb contribute` posts queued lessons to cq, annotated with their Barry provenance (`--dry-run` to preview).

Sharing is **off by default** and gated by mode:

```bash
barry-cache kb sharing status
barry-cache kb sharing set local-only|preview-only|share-enabled
```

`local-only` never sends; `preview-only` lets you inspect payloads; `share-enabled` is required for any cq read or write.

### Connecting to cq

cq's hosted service issues a time-limited API key after you **sign in with GitHub or Google** at [cq.exchange](https://cq.exchange) (self-hosted instances set up their own auth). Hand that key to Barry once:

```bash
barry-cache kb cq login --api-key <key>        # add --url <addr> for a self-hosted/private cq
```

That stores the key in `.barry-cache/cq-credentials.json` (git-ignored, owner-only), records the endpoint, and enables sharing — `kb search --source cq` and `kb contribute` then just work. The default endpoint is **`https://api.cq.exchange`** (the hosted REST API; `cq.exchange` itself is the web UI). `kb cq status` shows the connection; `kb cq logout` removes the key and returns to local-only. You can also pipe the key (`pbpaste | barry-cache kb cq login`) instead of passing it on the command line.

For CI, skip `login` and instead set `shared_kb.cq` to `{ "url": "…", "api_key_ref": "env:CQ_API_KEY" }` in `.barry-cache/config.json` and export `CQ_API_KEY` (an `api_key_ref` takes precedence over a stored key). See the [cq docs](https://github.com/mozilla-ai/cq) for obtaining a key and the current contract.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

Barry is developed with Bun and builds a Node-compatible CLI for npm distribution.
