# Barry Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Barry statistics that estimate tokens saved by budgeted `load` and `resume` commands.

**Architecture:** Store compact operational events in `.context-state/stats/events.jsonl`, then aggregate them through `barry stats` with `barry stats summary` kept as an alias. The stats layer depends only on existing budget reports and the filesystem helpers; it does not alter canonical context or send telemetry.

**Tech Stack:** TypeScript, Bun test runner, existing Barry CLI parser and JSONL operational memory patterns.

---

### Task 1: Core Stats Module

**Files:**
- Create: `src/core/stats.ts`
- Test: `tests/stats.test.ts`

- [x] **Step 1: Write failing tests**

Create tests that append two events, skip malformed rows while reading, aggregate totals, and filter by `--since`-style windows.

- [x] **Step 2: Run tests and verify red**

Run: `bun test tests/stats.test.ts`
Expected: FAIL because `src/core/stats.ts` does not exist.

- [x] **Step 3: Implement minimal stats module**

Add event append, event read, summary aggregation, and `parseStatsSince` helpers.

- [x] **Step 4: Run tests and verify green**

Run: `bun test tests/stats.test.ts`
Expected: PASS.

### Task 2: CLI Recording And Summary

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-stats.test.ts`

- [x] **Step 1: Write failing CLI tests**

Cover `load` recording a stats event, `resume` recording a stats event, `load --expand all` not recording a budget event, plain summary output, JSON summary output, and `--since` validation.

- [x] **Step 2: Run tests and verify red**

Run: `bun test tests/cli-stats.test.ts`
Expected: FAIL because `stats` command and recording do not exist.

- [x] **Step 3: Wire CLI behavior**

Import stats helpers, append one event after budgeted `load` and `resume`, add `stats` summary output with the `summary` alias, update help and usage text, and format plain output as estimated heuristic savings.

- [x] **Step 4: Run tests and verify green**

Run: `bun test tests/cli-stats.test.ts`
Expected: PASS.

### Task 3: Init And Context Documentation

**Files:**
- Modify: `src/core/init.ts`
- Modify: `docs/context/adrs/*`
- Modify: `docs/context/features/context-loading/FACTS.jsonl`
- Modify: `docs/context/features/context-loading/IDMAP.md`
- Test: `tests/init.test.ts`

- [x] **Step 1: Write/adjust tests**

Assert `initProject` creates `.context-state/stats`.

- [x] **Step 2: Implement init directory creation**

Create `.context-state/stats` alongside existing operational directories.

- [x] **Step 3: Add ADR and source-backed fact**

Record the operational stats storage/command decision and link it from the context-loading feature.

- [x] **Step 4: Verify**

Run: `bun run barry -- validate`, `bun test`, `bun run build`.
Expected: all pass.
