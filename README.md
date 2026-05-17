# Barry Cache

Barry Cache remembers your repo.

It creates source-backed context files for coding agents, validates them, and gives agents a deterministic CLI for loading the smallest useful slice of project knowledge.

## Install

```bash
npx barry-cache init
```

For non-interactive setup:

```bash
npx barry-cache init --yes
```

Preview changes without writing files:

```bash
npx barry-cache init --dry-run
```

## Core Commands

```bash
barry-cache validate
barry-cache route --task "fix playback drift"
barry-cache search --query "transport clock"
barry-cache load --route renderer-runtime
barry-cache resume --task "fix playback drift"
barry-cache finalize --status success --summary "Updated renderer clock context"
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

The repository uses Bun for development and builds a Node-compatible CLI for npm distribution.
