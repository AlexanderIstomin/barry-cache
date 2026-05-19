# Barry Cache

<p align="center">
  <img src="assets/barry-cache.png" alt="Barry Cache" width="420">
</p>

Barry Cache remembers your repo.

It creates source-backed context files for coding agents, validates them, and gives agents a deterministic CLI for loading the smallest useful slice of project knowledge.

## Reasoning

Barry Cache exists because coding agents need durable project context that is shared, reviewable, and smaller than the whole repository. Private assistant memory, ad hoc chat history, and vendor-specific instruction files drift apart; Barry keeps the source of truth in the repo and lets every agent load the same facts.

The structure is intentionally layered: canonical context lives in `docs/context/`, operational continuity lives in `.context-state/`, and generated retrieval data lives in `.context-cache/`. Canonical facts stay source-backed and validated, while `route`, `search`, `load`, and `resume` project only the relevant feature pack into an agent session.

That gives Barry three core advantages: it is agent-agnostic, because adapters point to one canonical context; auditable, because facts carry stable IDs and source references; and context-efficient, because agents start from a small routed slice instead of rereading the whole codebase.

## Quick Start

```bash
npx barry-cache init
```

This bootstraps Barry Cache in the current repository. It creates `docs/context/`, patches agent instruction files, adds npm scripts when a `package.json` exists, and creates ignored runtime folders for handoffs and caches.

By default, `init` writes instruction files for all supported agents. To keep the repo focused on one agent, pass `--agents`. For example, Codex-only setup writes `AGENTS.md` but skips Copilot, Cursor, Claude, Gemini, and `llms.txt` adapters:

```bash
npx barry-cache init --agents codex
```

For non-interactive setup, use:

```bash
npx barry-cache init --yes
```

To preview the setup without writing files, use:

```bash
npx barry-cache init --dry-run
```

## Command Reference

### `barry-cache init`

Creates or updates the Barry Cache project structure.

```bash
barry-cache init
barry-cache init --yes
barry-cache init --dry-run
barry-cache init --agents codex
```

It writes the canonical context directory, schemas, selected agent instruction files, and the managed `.gitignore` block.

Use this when adding Barry Cache to a repo for the first time or regenerating adapter files after an upgrade.

Flags:
- `--yes`: run with conservative defaults.
- `--dry-run`: report planned writes and updates without changing files.
- `--agents <list>`: choose instruction adapters to generate. Use `all` (default), `none`, or a comma-separated list from `codex`, `cursor`, `copilot`, `claude`, `gemini`, and `llms`.

### `barry-cache validate`

Checks whether the repo context is structurally valid.

```bash
barry-cache validate
```

It verifies required context files exist and validates every fact row in `docs/context/features/*/FACTS.jsonl`.

Use this after editing context files, importing memory, or before committing Barry Cache changes.

### `barry-cache doctor`

Runs the same health check as `validate`, but phrases the result as a setup health report.

```bash
barry-cache doctor
```

Use this when you want to know whether Barry Cache is installed correctly in the repository.

### `barry-cache route`

Scores feature context packs against a task and returns the most relevant routes.

```bash
barry-cache route --task "fix playback drift"
```

It reads `docs/context/features/*` and matches the task against feature README text, ID maps, graph edges, and facts.

Use this when deciding which context pack an agent should load before doing work.

### `barry-cache search`

Searches feature packs and facts for a query.

```bash
barry-cache search --query "transport clock"
```

It returns matching feature packs and fact records with route, score, source, and text.

Use this when you know a term, file, component, or concept and want to find the relevant memory.

### `barry-cache load`

Loads one feature context pack.

```bash
barry-cache load --route renderer-runtime
```

It returns the feature README, facts, and source file list for `docs/context/features/<route>/`.

Use this after `route` or `search` selects a specific feature.

### `barry-cache resume`

Builds an agent startup brief for a task.

```bash
barry-cache resume --task "fix playback drift"
```

It routes the task, selects the top context packs, and returns an execution contract with the first action, edit scope, and validation commands.

Use this at the start of a Codex, Claude, Cursor, Copilot, Gemini, or other coding-agent session.

### `barry-cache finalize`

Records the outcome of a work session.

```bash
barry-cache finalize --status success --summary "Updated renderer clock context"
```

```bash
barry-cache finalize --status partial --summary "Found root cause but did not patch"
```

It appends a JSONL handoff record to `.context-state/handoffs/handoffs.jsonl`.

Use this before ending a meaningful work session so the next agent can recover what happened.

Statuses:
- `success`: the task was completed.
- `partial`: some useful progress was made.
- `blocked`: the task cannot proceed without external input.
- `failed`: the attempted approach did not work.

### `barry-cache review`

Opens a local browser tool for inspecting memory.

```bash
barry-cache review
barry-cache review --port 8787
barry-cache review --open
barry-cache review --json
```

Browser mode serves a feature-first relational tree explorer and inspector at `http://127.0.0.1:8787` by default. The tree supports feature selection, grouping, related-fact activation, local expansion, and zoom/pan for larger memory sets.

JSON mode exports the same graph/list/timeline/tree model without starting a long-running server.

Use this when you want to audit what Barry Cache currently knows.

### `barry-cache import`

Imports memory from another system.

```bash
barry-cache import --source pulpcut-kb --from /path/to/pulpcut-frontend
```

```bash
barry-cache import --source pulpcut-kb --from /path/to/pulpcut-frontend --dry-run --json
```

Currently supported source:
- `pulpcut-kb`: imports old PulpCut KB folders from `docs/<feature>/`.

The PulpCut importer converts:
- `docs/KB_INDEX.md` into feature README route context.
- `docs/<feature>/IDMAP.md` into `docs/context/features/<feature>/IDMAP.md`.
- `docs/<feature>/KG.adj` into `docs/context/features/<feature>/KG.adj`.
- `docs/<feature>/FACTS.jsonl` old `{id,s,p,o,src}` records into Barry `{id,subject,predicate,object,src,status,kind,updated_at}` facts.

Use `--dry-run --json` first when importing a large memory base.

### `barry-cache generate-adapters`

Reports that adapter generation is handled by `init`.

```bash
barry-cache generate-adapters
```

This command exists as a stable placeholder for future explicit adapter regeneration. For now, run `barry-cache init` to regenerate agent adapter files.

### `barry-cache lint-wiki`

Runs wiki lint checks.

```bash
barry-cache lint-wiki
```

This is currently a lightweight placeholder and returns success. It is reserved for future checks over generated or maintained wiki-style context pages.

## Common Workflows

### Add Barry Cache To A Repo

Run this once from the repository root:

```bash
npx barry-cache init
```

After this, Barry Cache writes short instructions into agent-facing files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/barry-cache.mdc`, and `.github/copilot-instructions.md`.

For a Codex-only repo, use:

```bash
npx barry-cache init --agents codex
```

Those generated files tell coding agents how to use Barry before they edit the repo.

### Ask An Agent To Work On A Task

Usually, you do not need to run `barry-cache resume` yourself.

Ask your coding agent normally:

```text
Fix playback drift in the editor.
```

Because `barry-cache init` added instructions to the repo, the agent should run this before non-trivial work:

```bash
barry-cache resume --task "fix playback drift in the editor"
```

The agent then uses the returned routes to load focused context:

```bash
barry-cache load --route editor-media-runtime
```

This keeps the agent from reading every context file in the repo.

If an agent ignores the repo instructions, prompt it explicitly:

```text
Before editing, follow Barry Cache protocol:
1. Run barry-cache resume --task "<my task>".
2. Load the returned route context.
3. Do the work.
4. Run validation.
5. Finalize the session if useful.
```

### Inspect Context Yourself

Use these commands when you want to see what Barry would give an agent:

```bash
barry-cache route --task "fix playback drift"
barry-cache search --query "transport clock"
barry-cache load --route editor-media-runtime
```

Use the browser review tool for a broader overview:

```bash
barry-cache review
```

### Save Agent Sessions

At the end of a meaningful session, ask the agent:

```text
Save this session to Barry Cache.

Rules:
1. Record the session outcome with barry-cache finalize.
2. Promote only source-backed implementation facts into docs/context/features/*/FACTS.jsonl.
3. Put uncertain notes, blockers, and next steps in operational memory, not canonical facts.
4. Update IDMAP.md or KG.adj only when new source IDs or relationships are needed.
5. Run barry-cache validate before finishing.
```

The minimum useful save is:

```bash
barry-cache finalize --status success --summary "Short session outcome"
```

This writes an operational handoff into `.context-state/handoffs/handoffs.jsonl`. It does not automatically turn chat content into canonical facts.

### Import And Review Old Memory

When migrating an old PulpCut KB, preview the import first:

```bash
barry-cache import --source pulpcut-kb --from /path/to/pulpcut-frontend --dry-run --json
```

If the result looks right, apply it and validate:

```bash
barry-cache import --source pulpcut-kb --from /path/to/pulpcut-frontend
barry-cache validate
```

Then inspect the imported memory:

```bash
barry-cache review
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

The repository uses Bun for development and builds a Node-compatible CLI for npm distribution.
