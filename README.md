# Barry Cache

<p align="center">
  <img src="https://raw.githubusercontent.com/AlexanderIstomin/barry-cache/main/assets/barry-cache.png" alt="Barry Cache" width="420">
</p>

Barry Cache remembers your repo.

It creates source-backed context files for coding agents, validates them, and gives agents a deterministic CLI for loading the smallest useful slice of project knowledge.

[Changelog](https://github.com/AlexanderIstomin/barry-cache/blob/main/CHANGELOG.md)

## Reasoning

Barry Cache exists because coding agents need durable project context that is shared, reviewable, and smaller than the whole repository. Private assistant memory, ad hoc chat history, and vendor-specific instruction files drift apart; Barry keeps the source of truth in the repo and lets every agent load the same facts.

The structure is intentionally layered: canonical context lives in `docs/context/`, operational continuity lives in `.context-state/`, and generated retrieval data lives in `.context-cache/`. Canonical facts stay source-backed and validated, while `route`, `search`, `load`, and `resume` project only the relevant feature pack into an agent session. Repeated retrieval commands reuse `.context-cache/context-index.json` when the source context file manifest is unchanged.

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

Shared/community solutions KB publishing is documented in [Shared KB Cloudflare Distribution](docs/shared-kb-cloudflare.md).
Shared KB contribution is disabled by default; inspect or change the repo-local mode with `barry-cache kb sharing status` and `barry-cache kb sharing set local-only|preview-only|share-enabled`. Remote shared KB search requires `share-enabled`; local snapshot search remains available in every mode.

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

It verifies required context files, ADR frontmatter, and every fact row in `docs/context/features/*/FACTS.jsonl`.

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

Searches feature packs, facts, and ADRs for a query.

```bash
barry-cache search --query "transport clock"
```

It returns matching feature packs, fact records, and ADR records with route, score, source, and text.

Use this when you know a term, file, component, or concept and want to find the relevant memory.

### `barry-cache load`

Loads one feature context pack.

```bash
barry-cache load --route renderer-runtime
```

It returns the feature README, facts, linked ADRs, and source file list for `docs/context/features/<route>/`.

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

`finalize` writes operational memory only. It does not update canonical project context in `docs/context/`. If a task introduced durable implementation behavior, add or update source-backed facts in `docs/context/features/*/FACTS.jsonl` and run `barry-cache validate`.

Statuses:
- `success`: the task was completed.
- `partial`: some useful progress was made.
- `blocked`: the task cannot proceed without external input.
- `failed`: the attempted approach did not work.

### `barry-cache adr`

Creates and lists architecture decision records.

```bash
barry-cache adr new --title "Use repo-native context"
barry-cache adr new --title "Keep generated indexes disposable" --tags context,cache
barry-cache adr list
```

ADRs live in `docs/context/adrs/` as Markdown files with frontmatter. Use them for durable architectural decisions, then reference the ADR file from decision facts with `src`.

```json
{
  "id": "CTX001",
  "subject": "Barry",
  "predicate": "stores canonical context in",
  "object": "docs/context/",
  "src": ["docs/context/adrs/ADR-0001-use-repo-native-context.md"],
  "status": "active",
  "kind": "decision",
  "updated_at": "2026-05-19"
}
```

Barry can then search the ADR, route tasks through feature facts linked to it, load it with the relevant feature pack, and show it in review data.

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

When a package manager is detected, those instructions use the repo package script instead of assuming `barry-cache` is on `PATH`. For a Bun repo, agents are told to run commands like:

```bash
bun run barry -- resume --task "fix playback drift in the editor"
```

For a Codex-only repo, use:

```bash
npx barry-cache init --agents codex
```

Those generated files tell coding agents how to use Barry before they edit the repo.

### Ask An Agent To Work On A Task

Usually, you do not need to run Barry yourself.

Ask your coding agent normally:

```text
Fix playback drift in the editor.
```

Because `barry-cache init` added instructions to the repo, the agent should run this before non-trivial work:

```bash
bun run barry -- resume --task "fix playback drift in the editor"
```

The generated instruction file uses the package manager Barry detected for that repo, for example `bun`, `npm`, `pnpm`, or `yarn`.

The agent then uses the returned routes to load focused context:

```bash
bun run barry -- load --route editor-media-runtime
```

This keeps the agent from reading every context file in the repo.

Barry also keeps a disposable parsed context index in `.context-cache/context-index.json`. It is keyed by the source context files and directories, so repeated `resume`, `load`, `route`, `search`, and `review --json` commands reuse parsed context until a context source file changes.

If an agent ignores the repo instructions, prompt it explicitly:

```text
Before editing, follow Barry Cache protocol:
1. Run the repo's Barry package script, for example bun run barry -- resume --task "<my task>".
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

### Record An Architectural Decision

Create an ADR when a decision explains why future agents should preserve or intentionally change architecture:

```bash
barry-cache adr new --title "Use repo-native context" --tags context,agents
```

Then add or update a `kind: "decision"` fact in the relevant feature pack and point `src` to the ADR file. That keeps the human-readable reasoning and the machine-routable fact connected.

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
6. Do not claim Barry canonical memory is updated unless docs/context/ changed.
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
