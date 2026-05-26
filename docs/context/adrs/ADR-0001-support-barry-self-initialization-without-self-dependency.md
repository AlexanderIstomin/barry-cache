---
id: ADR-0001
title: Support Barry self initialization without self dependency
status: active
date: 2026-05-26
supersedes: []
tags: [init, self-hosting, context]
---

# ADR-0001: Support Barry self initialization without self dependency

## Context

Barry Cache should be able to preserve memory for the Barry Cache repository itself. A normal consumer repository needs `barry-cache` as a development dependency so package scripts and generated agent instructions can call the installed CLI.

The Barry Cache source repository is different: adding `barry-cache` to its own `devDependencies` creates a self-dependency, and a generated `barry` script that calls the installed `barry-cache` binary does not work before the package is installed or linked.

## Decision

When `initProject` patches a `package.json` whose package name is `barry-cache`, it treats the repository as the Barry source checkout:

- It does not add `barry-cache` to `devDependencies`.
- It writes Barry package scripts that run the local source CLI through `bun run src/cli.ts`.
- It repairs the older generated self-hosting script values if they are exactly the default installed-package commands.

Consumer repositories keep the existing behavior: Barry adds a `barry-cache` development dependency and package scripts call the installed `barry-cache` binary.

## Consequences

Barry can initialize and validate its own `docs/context/` memory without relying on a published copy of itself. The generated Codex instructions still use `bun run barry -- ...`, but that script now resolves to the local source CLI in this repository.

The self-hosting path assumes the Barry source repository uses Bun for development. If Barry later supports a different development runtime, the self-hosting script selection should be revisited.
