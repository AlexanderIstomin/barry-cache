# Context Authoring Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Barry CLI guardrails that help agents author canonical context without replacing Git-reviewable source files as the source of truth.

**Architecture:** Keep `docs/context/` as canonical source and extend Barry around it with validation, scaffolding, and draft/append helpers. Validation becomes the main safety boundary; CLI write helpers are explicit, small, and source-file preserving.

**Tech Stack:** Bun test runner, TypeScript CLI, JSONL context files, Markdown feature packs.

---

### Task 1: Validation Guardrails

**Files:**
- Modify: `src/core/validate.ts`
- Test: `tests/context-flow.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that create context packs with duplicate fact IDs, invalid fact enum values, non-ISO timestamps, unresolved `src` IDs, malformed `IDMAP.md` rows, and malformed `KG.adj` rows.

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/context-flow.test.ts`
Expected: FAIL because current validation accepts those malformed rows.

- [ ] **Step 3: Implement validation**

Extend `validateProject` with feature-local ID map parsing, graph row checks, duplicate fact ID checks, source resolution checks, and stricter optional enum/timestamp validation.

- [ ] **Step 4: Re-run focused tests**

Run: `bun test tests/context-flow.test.ts`
Expected: PASS.

### Task 2: Feature Scaffold CLI

**Files:**
- Create: `src/core/authoring.ts`
- Modify: `src/cli.ts`
- Test: `tests/cli-authoring.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Cover `barry-cache feature new --slug renderer-runtime --title "Renderer Runtime" --summary "Owns runtime scheduling." --json`, existing feature refusal, invalid slug errors, and `--dry-run`.

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/cli-authoring.test.ts`
Expected: FAIL because `feature` command is not implemented.

- [ ] **Step 3: Implement scaffold helper and CLI route**

Create feature directories with `README.md`, `IDMAP.md`, `KG.adj`, and `FACTS.jsonl`; refuse overwrites; support dry-run and JSON.

- [ ] **Step 4: Re-run focused tests**

Run: `bun test tests/cli-authoring.test.ts`
Expected: PASS.

### Task 3: Fact Draft And Explicit Append CLI

**Files:**
- Modify: `src/core/authoring.ts`
- Modify: `src/cli.ts`
- Test: `tests/cli-authoring.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Cover `barry-cache fact draft` JSONL output, generated collision-resistant IDs from `--prefix`, default timestamp/kind/status/confidence, `--write` append behavior, missing route/source errors, and duplicate ID refusal.

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/cli-authoring.test.ts`
Expected: FAIL because `fact` command is not implemented.

- [ ] **Step 3: Implement draft and append**

Generate one fact row from required semantic flags, validate it with the same fact validator, print JSONL by default, and only append when `--write` is passed.

- [ ] **Step 4: Re-run focused tests**

Run: `bun test tests/cli-authoring.test.ts`
Expected: PASS.

### Task 4: Documentation And Canonical Context

**Files:**
- Modify: `README.md`
- Modify: `docs/context/MAINTENANCE.md`
- Modify: `docs/context/features/init-bootstrap/IDMAP.md`
- Modify: `docs/context/features/init-bootstrap/KG.adj`
- Modify: `docs/context/features/init-bootstrap/FACTS.jsonl`
- Create: `docs/context/adrs/ADR-0007-context-authoring-guardrails.md`

- [ ] **Step 1: Create ADR**

Run: `bun run barry -- adr new --title "Add context authoring guardrails" --tags context,cli,validation`
Expected: creates the next ADR file.

- [ ] **Step 2: Update docs and facts**

Document validation/scaffold/draft usage while preserving the no broad CRUD policy. Add source IDs and a decision fact linked to the ADR.

- [ ] **Step 3: Validate Barry context**

Run: `bun run barry -- validate`
Expected: PASS.

### Task 5: Full Verification

**Files:**
- All touched source, test, and context files.

- [ ] **Step 1: Run focused tests**

Run: `bun test tests/context-flow.test.ts tests/cli-authoring.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `bun test`
Expected: PASS.

- [ ] **Step 3: Run Barry validation**

Run: `bun run barry -- validate`
Expected: PASS.

- [ ] **Step 4: Record handoff**

Run: `bun run barry -- finalize --status success --summary "<summary>" --files "<files>" --tests "bun test,bun run barry -- validate"`
Expected: operational handoff saved.

