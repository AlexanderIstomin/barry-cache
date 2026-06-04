# Shared Solutions KB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-maintenance shared solutions KB flow where community-reviewed anonymized JSONL lessons can be validated, signed into immutable snapshots, distributed through Git/Cloudflare Pages/R2, and searched by Barry agents.

**Architecture:** Keep shared KB source records outside repo-local Barry canonical memory. Barry validates and builds static shared KB packs from Git-reviewed JSONL, writes generated snapshot/index files for cheap CDN/R2 distribution, and lets agents search trusted records only by default. Cloudflare is a distribution target, not the source of truth; API submissions, live voting, D1 moderation queues, and richer gamification are separate follow-up projects.

**Tech Stack:** Bun tests, TypeScript, Node 20 runtime APIs, Node `crypto` for SHA-256 and Ed25519 signatures, existing Barry CLI parser, existing filesystem helpers, JSONL source records, signed JSON manifests, Cloudflare Pages/R2 deployment docs.

---

## Scope Check

This plan implements the v1 static trust pipeline:

- Git PRs as the write/review path.
- JSONL lesson and revocation source files.
- Validation for schema, duplicate IDs, publication states, and revealing strings.
- Snapshot build output for Cloudflare Pages/R2.
- Optional Ed25519 manifest signature files.
- Local or HTTP search over generated snapshot indexes.
- Barry canonical context updates for this durable new feature.

This plan intentionally does not implement public API submissions, D1 queues, live helpful votes, wallet identity, or dynamic badge counters. Those are independent systems and should get separate plans after the static KB pack works.

## File Structure

- Create `src/core/shared-kb.ts`: shared KB types, JSONL parsing, validation, redaction checks, snapshot building, manifest hashing/signing, local/HTTP snapshot loading, and search.
- Modify `src/cli.ts`: add `barry-cache kb validate`, `barry-cache kb build`, and `barry-cache kb search`.
- Create `tests/shared-kb.test.ts`: direct core tests for validation, snapshot building, signing, and search ranking.
- Create `tests/cli-kb.test.ts`: CLI argument and workflow tests.
- Create `docs/shared-kb-cloudflare.md`: v1 operating guide for Git PR review, signed snapshot generation, Cloudflare Pages/R2 publishing, trust states, and abuse handling.
- Create `docs/context/features/shared-kb/README.md`: Barry source-backed context pack for shared KB behavior.
- Create `docs/context/features/shared-kb/IDMAP.md`: source ID map for shared KB implementation.
- Create `docs/context/features/shared-kb/KG.adj`: relationship graph for shared KB behavior.
- Create `docs/context/features/shared-kb/FACTS.jsonl`: durable facts for the new feature.
- Create ADR through the existing CLI: `docs/context/adrs/ADR-0007-store-shared-solutions-kb-as-signed-static-packs.md`.

---

### Task 1: Core Shared KB Validation

**Files:**
- Create: `src/core/shared-kb.ts`
- Create: `tests/shared-kb.test.ts`

- [ ] **Step 1: Write failing tests for valid and invalid shared KB lesson records**

Create `tests/shared-kb.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSharedKbSource, validateSharedKbLesson } from "../src/core/shared-kb";
import { withTempRepo } from "./helpers";

function validLesson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "lesson-20260603-a8f3",
    kind: "anti_pattern",
    status: "trusted",
    title: "Treat handoffs as claims until validated",
    problem: "Agents may treat previous handoff summaries as proof of correctness.",
    applies_when: ["multi-agent coding workflow", "handoff records exist", "user validation can contradict prior claims"],
    recommendation: "Record user-observed failures as contradiction events and link later fixes back to them.",
    why: "This preserves stale assumptions without promoting them to canonical project truth.",
    avoid_when: ["the source cannot be safely anonymized", "there is no validated observed failure"],
    confidence: "high",
    evidence: {
      source_type: "anonymized_project_pattern",
      count: 1,
      has_follow_up_fix: true
    },
    tags: ["agents", "validation", "handoff"],
    updated_at: "2026-06-03T10:00:00.000Z",
    ...overrides,
  };
}

describe("shared KB validation", () => {
  test("accepts anonymized trusted lessons", () => {
    expect(validateSharedKbLesson(validLesson())).toEqual([]);
  });

  test("requires applicability, recommendation, rationale, and evidence", () => {
    const errors = validateSharedKbLesson({
      id: "lesson-20260603-b1c4",
      kind: "lesson",
      status: "trusted",
      title: "Incomplete lesson",
      updated_at: "2026-06-03T10:00:00.000Z"
    });

    expect(errors).toContain("missing required field: problem");
    expect(errors).toContain("missing required field: applies_when");
    expect(errors).toContain("missing required field: recommendation");
    expect(errors).toContain("missing required field: why");
    expect(errors).toContain("missing required field: evidence");
  });

  test("rejects revealing file paths, emails, and secret-looking tokens", () => {
    const errors = validateSharedKbLesson(validLesson({
      recommendation: "Patch src/internal/payments.ts after emailing owner@example.com with token sk-test-1234567890abcdef."
    }));

    expect(errors).toContain("field recommendation contains revealing file path: src/internal/payments.ts");
    expect(errors).toContain("field recommendation contains email address");
    expect(errors).toContain("field recommendation contains secret-looking token");
  });

  test("validates JSONL source directories and reports duplicate lesson IDs", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      const lesson = validLesson();
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson)}\n${JSON.stringify(lesson)}\n`);

      const result = await validateSharedKbSource({ source });

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "lessons/agents.jsonl",
        line: 2,
        message: "duplicate lesson id: lesson-20260603-a8f3"
      }));
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails because the module is missing**

Run:

```bash
bun test tests/shared-kb.test.ts
```

Expected: FAIL with an import error for `../src/core/shared-kb`.

- [ ] **Step 3: Implement validation helpers**

Create `src/core/shared-kb.ts` with these exported types and functions:

```ts
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { readTextIfExists, writeText } from "./fs";
import type { CommandIssue } from "./types";

export const sharedKbKinds = ["lesson", "anti_pattern", "decision_pattern"] as const;
export const sharedKbStatuses = ["submitted", "quarantined", "reviewed", "trusted", "rejected", "challenged", "deprecated", "revoked", "superseded"] as const;
export const sharedKbPublishedStatuses = ["reviewed", "trusted", "challenged", "deprecated", "superseded"] as const;

export type SharedKbKind = typeof sharedKbKinds[number];
export type SharedKbStatus = typeof sharedKbStatuses[number];
export type SharedKbConfidence = "low" | "medium" | "high";

export interface SharedKbEvidence {
  source_type: "anonymized_project_pattern" | "community_report" | "maintainer_review";
  count: number;
  has_follow_up_fix?: boolean;
  notes?: string;
}

export interface SharedKbLesson {
  id: string;
  kind: SharedKbKind;
  status: SharedKbStatus;
  title: string;
  problem: string;
  applies_when: string[];
  recommendation: string;
  why: string;
  avoid_when: string[];
  confidence: SharedKbConfidence;
  evidence: SharedKbEvidence;
  tags: string[];
  updated_at: string;
  supersedes?: string[];
}

export interface SharedKbRevocation {
  id: string;
  target: string;
  status: "challenged" | "deprecated" | "revoked" | "superseded";
  reason: string;
  replacement?: string;
  updated_at: string;
}

export interface SharedKbValidationResult {
  ok: boolean;
  errors: CommandIssue[];
  warnings: CommandIssue[];
  lessons: SharedKbLesson[];
  revocations: SharedKbRevocation[];
}

const requiredLessonFields: Array<keyof SharedKbLesson> = [
  "id",
  "kind",
  "status",
  "title",
  "problem",
  "applies_when",
  "recommendation",
  "why",
  "avoid_when",
  "confidence",
  "evidence",
  "tags",
  "updated_at",
];

export function validateSharedKbLesson(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["lesson must be an object"];
  const lesson = value as Partial<SharedKbLesson>;

  for (const field of requiredLessonFields) {
    if (lesson[field] === undefined) errors.push(`missing required field: ${field}`);
  }

  if (lesson.id !== undefined && (!isString(lesson.id) || !/^lesson-[0-9]{8}[A-Za-z0-9-]*$/.test(lesson.id))) errors.push("invalid field: id");
  if (lesson.kind !== undefined && !sharedKbKinds.includes(lesson.kind as SharedKbKind)) errors.push("invalid field: kind");
  if (lesson.status !== undefined && !sharedKbStatuses.includes(lesson.status as SharedKbStatus)) errors.push("invalid field: status");
  for (const field of ["title", "problem", "recommendation", "why", "updated_at"] as const) {
    if (lesson[field] !== undefined && !isNonEmptyString(lesson[field])) errors.push(`invalid field: ${field}`);
  }
  for (const field of ["applies_when", "avoid_when", "tags", "supersedes"] as const) {
    const fieldValue = lesson[field];
    if (fieldValue !== undefined && (!Array.isArray(fieldValue) || fieldValue.some((item) => !isNonEmptyString(item)))) {
      errors.push(`invalid field: ${field}`);
    }
  }
  if (lesson.confidence !== undefined && !["low", "medium", "high"].includes(String(lesson.confidence))) errors.push("invalid field: confidence");
  if (lesson.evidence !== undefined) errors.push(...validateEvidence(lesson.evidence));
  errors.push(...redactionErrors(lesson));
  return errors;
}

export async function validateSharedKbSource({ source }: { source: string }): Promise<SharedKbValidationResult> {
  const errors: CommandIssue[] = [];
  const warnings: CommandIssue[] = [];
  const lessons: SharedKbLesson[] = [];
  const revocations: SharedKbRevocation[] = [];
  const seenLessonIds = new Set<string>();

  for (const file of await jsonlFiles(join(source, "lessons"))) {
    const rows = await readJsonl(join(source, "lessons", file));
    rows.forEach((row, index) => {
      const displayFile = `lessons/${file}`;
      const line = index + 1;
      if (row.trim().length === 0) return;
      try {
        const parsed = JSON.parse(row) as unknown;
        const recordErrors = validateSharedKbLesson(parsed);
        for (const message of recordErrors) errors.push({ file: displayFile, line, message });
        if (recordErrors.length === 0) {
          const lesson = parsed as SharedKbLesson;
          if (seenLessonIds.has(lesson.id)) {
            errors.push({ file: displayFile, line, message: `duplicate lesson id: ${lesson.id}` });
          } else {
            seenLessonIds.add(lesson.id);
            lessons.push(lesson);
          }
        }
      } catch {
        errors.push({ file: displayFile, line, message: "invalid JSON" });
      }
    });
  }

  const revocationRows = await readJsonl(join(source, "revocations.jsonl"));
  revocationRows.forEach((row, index) => {
    const line = index + 1;
    if (row.trim().length === 0) return;
    try {
      const parsed = JSON.parse(row) as unknown;
      const message = validateRevocation(parsed);
      if (message) errors.push({ file: "revocations.jsonl", line, message });
      if (!message) revocations.push(parsed as SharedKbRevocation);
    } catch {
      errors.push({ file: "revocations.jsonl", line, message: "invalid JSON" });
    }
  });

  for (const revocation of revocations) {
    if (!seenLessonIds.has(revocation.target)) warnings.push({ file: "revocations.jsonl", message: `revocation references missing lesson: ${revocation.target}` });
  }

  return { ok: errors.length === 0, errors, warnings, lessons, revocations };
}

function validateEvidence(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["invalid field: evidence"];
  const evidence = value as Partial<SharedKbEvidence>;
  const errors: string[] = [];
  if (!["anonymized_project_pattern", "community_report", "maintainer_review"].includes(String(evidence.source_type))) errors.push("invalid field: evidence.source_type");
  if (!Number.isInteger(evidence.count) || Number(evidence.count) < 1) errors.push("invalid field: evidence.count");
  if (evidence.has_follow_up_fix !== undefined && typeof evidence.has_follow_up_fix !== "boolean") errors.push("invalid field: evidence.has_follow_up_fix");
  if (evidence.notes !== undefined && !isNonEmptyString(evidence.notes)) errors.push("invalid field: evidence.notes");
  return errors;
}

function validateRevocation(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "revocation must be an object";
  const record = value as Partial<SharedKbRevocation>;
  for (const field of ["id", "target", "status", "reason", "updated_at"] as const) {
    if (!isNonEmptyString(record[field])) return `invalid field: ${field}`;
  }
  if (!["challenged", "deprecated", "revoked", "superseded"].includes(record.status)) return "invalid field: status";
  if (record.replacement !== undefined && !isNonEmptyString(record.replacement)) return "invalid field: replacement";
  return null;
}

function redactionErrors(lesson: Partial<SharedKbLesson>): string[] {
  const errors: string[] = [];
  const fields: Array<keyof SharedKbLesson> = ["title", "problem", "recommendation", "why"];
  for (const field of fields) {
    const value = lesson[field];
    if (!isString(value)) continue;
    const path = value.match(/\b(?:src|app|lib|packages|internal|docs|tests)\/[A-Za-z0-9_./-]+\b/);
    if (path) errors.push(`field ${field} contains revealing file path: ${path[0]}`);
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) errors.push(`field ${field} contains email address`);
    if (/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|AKIA[A-Za-z0-9]{8,})\b/.test(value)) errors.push(`field ${field} contains secret-looking token`);
    if (/https?:\/\/(?!example\.com\b)[^\s]+/.test(value)) errors.push(`field ${field} contains non-example URL`);
  }
  return errors;
}

async function jsonlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonl(path: string): Promise<string[]> {
  return (await readTextIfExists(path)).split(/\r?\n/);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
```

The imports for `crypto`, `mkdir`, `relative`, `writeText`, and hashing helpers will be used in Task 2 and Task 3; keeping them in this file now is acceptable because the next tasks fill them in before the full suite runs.

- [ ] **Step 4: Run validation tests and verify they pass**

Run:

```bash
bun test tests/shared-kb.test.ts
```

Expected: PASS for the four validation tests.

- [ ] **Step 5: Commit validation foundation**

```bash
git add src/core/shared-kb.ts tests/shared-kb.test.ts
git commit -m "feat: add shared kb validation"
```

---

### Task 2: Snapshot Build, Manifest Hashes, Revocations, And Search Index

**Files:**
- Modify: `src/core/shared-kb.ts`
- Modify: `tests/shared-kb.test.ts`

- [ ] **Step 1: Add failing tests for snapshot building and default trusted search**

Append these tests to `tests/shared-kb.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { buildSharedKbSnapshot, searchSharedKb } from "../src/core/shared-kb";

test("builds signed-pack-ready snapshots from reviewed and trusted lessons", async () => {
  await withTempRepo(async (repo) => {
    const source = join(repo, "shared-kb");
    const out = join(repo, "dist/shared-kb");
    await mkdir(join(source, "lessons"), { recursive: true });
    await writeFile(join(source, "lessons", "agents.jsonl"), [
      JSON.stringify(validLesson({ id: "lesson-20260603-a8f3", status: "trusted", tags: ["agents", "validation"] })),
      JSON.stringify(validLesson({ id: "lesson-20260603-b4d1", status: "submitted", tags: ["agents"] })),
      JSON.stringify(validLesson({ id: "lesson-20260603-c7e2", status: "reviewed", tags: ["review"] })),
      ""
    ].join("\n"));
    await writeFile(join(source, "revocations.jsonl"), `${JSON.stringify({
      id: "revocation-20260603-z9b1",
      target: "lesson-20260603-c7e2",
      status: "revoked",
      reason: "Community validation found the recommendation too broad.",
      updated_at: "2026-06-03T11:00:00.000Z"
    })}\n`);

    const result = await buildSharedKbSnapshot({ source, out });

    expect(result.published).toBe(1);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(manifest.version).toBe(1);
    expect(manifest.counts.lessons).toBe(1);
    expect(manifest.revoked).toEqual(["lesson-20260603-c7e2"]);
    expect(manifest.files).toContainEqual(expect.objectContaining({
      path: "lessons/lessons.jsonl",
      records: 1
    }));
    expect(manifest.files[0].sha256).toMatch(/^sha256:[a-f0-9]{64}$/);

    const index = JSON.parse(await readFile(join(out, "indexes/search-index.json"), "utf8"));
    expect(index.items).toHaveLength(1);
    expect(index.items[0].id).toBe("lesson-20260603-a8f3");
  });
});

test("searches generated snapshots and excludes non-trusted lessons by default", async () => {
  await withTempRepo(async (repo) => {
    const source = join(repo, "shared-kb");
    const out = join(repo, "dist/shared-kb");
    await mkdir(join(source, "lessons"), { recursive: true });
    await writeFile(join(source, "lessons", "agents.jsonl"), [
      JSON.stringify(validLesson({ id: "lesson-20260603-a8f3", status: "trusted", recommendation: "Record validation failures as contradiction events." })),
      JSON.stringify(validLesson({ id: "lesson-20260603-c7e2", status: "reviewed", recommendation: "Use challenge records for questionable community lessons." })),
      ""
    ].join("\n"));
    await buildSharedKbSnapshot({ source, out });

    const trusted = await searchSharedKb({ source: out, query: "challenge records" });
    expect(trusted.results).toHaveLength(0);

    const reviewed = await searchSharedKb({ source: out, query: "challenge records", includeReviewed: true });
    expect(reviewed.results[0]).toEqual(expect.objectContaining({
      id: "lesson-20260603-c7e2",
      status: "reviewed"
    }));
  });
});
```

- [ ] **Step 2: Run tests and verify missing exports fail**

Run:

```bash
bun test tests/shared-kb.test.ts
```

Expected: FAIL with missing `buildSharedKbSnapshot` and `searchSharedKb` exports.

- [ ] **Step 3: Add snapshot and search exports**

Extend `src/core/shared-kb.ts` with:

```ts
export interface SharedKbManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  records: number;
}

export interface SharedKbManifest {
  version: 1;
  generated_at: string;
  source: "barry-shared-kb";
  counts: {
    lessons: number;
    revoked: number;
  };
  files: SharedKbManifestFile[];
  lessons: string[];
  revoked: string[];
}

export interface SharedKbSearchIndex {
  version: 1;
  generated_at: string;
  items: SharedKbSearchItem[];
}

export interface SharedKbSearchItem {
  id: string;
  kind: SharedKbKind;
  status: SharedKbStatus;
  title: string;
  summary: string;
  tags: string[];
  confidence: SharedKbConfidence;
  updated_at: string;
  text: string;
}

export interface SharedKbSearchResult {
  query: string;
  results: Array<SharedKbSearchItem & { score: number }>;
}

export async function buildSharedKbSnapshot(options: { source: string; out: string }): Promise<{ ok: true; out: string; published: number; manifest: SharedKbManifest }> {
  const validation = await validateSharedKbSource({ source: options.source });
  if (!validation.ok) {
    const rendered = validation.errors.map((error) => `${error.file}${error.line ? `:${error.line}` : ""} ${error.message}`).join("\n");
    throw new Error(`Shared KB source is invalid:\n${rendered}`);
  }

  const revoked = new Set(validation.revocations.filter((record) => record.status === "revoked").map((record) => record.target));
  const lessons = validation.lessons
    .filter((lesson) => sharedKbPublishedStatuses.includes(lesson.status as typeof sharedKbPublishedStatuses[number]))
    .filter((lesson) => !revoked.has(lesson.id))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
  const index: SharedKbSearchIndex = {
    version: 1,
    generated_at: new Date().toISOString(),
    items: lessons.map(searchItemForLesson),
  };
  const lessonRows = `${lessons.map((lesson) => JSON.stringify(lesson)).join("\n")}${lessons.length ? "\n" : ""}`;
  const revocationRows = `${validation.revocations.map((record) => JSON.stringify(record)).join("\n")}${validation.revocations.length ? "\n" : ""}`;
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;

  await writeText(join(options.out, "lessons/lessons.jsonl"), lessonRows);
  await writeText(join(options.out, "revocations.jsonl"), revocationRows);
  await writeText(join(options.out, "indexes/search-index.json"), indexJson);

  const files: SharedKbManifestFile[] = [
    manifestFile("lessons/lessons.jsonl", lessonRows, lessons.length),
    manifestFile("revocations.jsonl", revocationRows, validation.revocations.length),
    manifestFile("indexes/search-index.json", indexJson, index.items.length),
  ];
  const manifest: SharedKbManifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: "barry-shared-kb",
    counts: {
      lessons: lessons.length,
      revoked: revoked.size,
    },
    files,
    lessons: lessons.map((lesson) => lesson.id),
    revoked: [...revoked].sort(),
  };
  await writeText(join(options.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, out: options.out, published: lessons.length, manifest };
}

export async function searchSharedKb(options: { source: string; query: string; includeReviewed?: boolean }): Promise<SharedKbSearchResult> {
  const index = await loadSearchIndex(options.source);
  const queryTokens = tokens(options.query);
  const allowedStatuses = options.includeReviewed ? new Set<SharedKbStatus>(["trusted", "reviewed"]) : new Set<SharedKbStatus>(["trusted"]);
  const results = index.items
    .filter((item) => allowedStatuses.has(item.status))
    .map((item) => ({ ...item, score: scoreText(item.text, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.confidence.localeCompare(a.confidence) || a.id.localeCompare(b.id));
  return { query: options.query, results };
}

async function loadSearchIndex(source: string): Promise<SharedKbSearchIndex> {
  if (/^https?:\/\//.test(source)) {
    const url = source.endsWith("/") ? `${source}indexes/search-index.json` : `${source}/indexes/search-index.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch shared KB index: ${response.status} ${response.statusText}`);
    return JSON.parse(await response.text()) as SharedKbSearchIndex;
  }
  return JSON.parse(await readTextIfExists(join(source, "indexes/search-index.json"))) as SharedKbSearchIndex;
}

function searchItemForLesson(lesson: SharedKbLesson): SharedKbSearchItem {
  const summary = `${lesson.problem} ${lesson.recommendation}`;
  return {
    id: lesson.id,
    kind: lesson.kind,
    status: lesson.status,
    title: lesson.title,
    summary,
    tags: lesson.tags,
    confidence: lesson.confidence,
    updated_at: lesson.updated_at,
    text: [
      lesson.id,
      lesson.kind,
      lesson.status,
      lesson.title,
      lesson.problem,
      lesson.applies_when.join(" "),
      lesson.recommendation,
      lesson.why,
      lesson.avoid_when.join(" "),
      lesson.confidence,
      lesson.tags.join(" "),
    ].join(" ").toLowerCase(),
  };
}

function manifestFile(path: string, content: string, records: number): SharedKbManifestFile {
  return {
    path,
    sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    bytes: Buffer.byteLength(content),
    records,
  };
}

function tokens(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

function scoreText(text: string, queryTokens: string[]): number {
  return queryTokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}
```

- [ ] **Step 4: Remove unused imports from `src/core/shared-kb.ts`**

After Task 2 implementation, the unused imports should be `createPrivateKey`, `createPublicKey`, `sign`, `verify`, `mkdir`, `basename`, `relative`, and possibly `CommandIssue` must remain used. Keep only imports that TypeScript accepts.

Expected top imports after this task:

```ts
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists, writeText } from "./fs";
import type { CommandIssue } from "./types";
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
bun test tests/shared-kb.test.ts
bun run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit snapshot and search core**

```bash
git add src/core/shared-kb.ts tests/shared-kb.test.ts
git commit -m "feat: build shared kb snapshots"
```

---

### Task 3: Manifest Signing And Verification

**Files:**
- Modify: `src/core/shared-kb.ts`
- Modify: `tests/shared-kb.test.ts`

- [ ] **Step 1: Add failing tests for Ed25519 signatures**

Append to `tests/shared-kb.test.ts`:

```ts
import { generateKeyPairSync } from "node:crypto";
import { verifySharedKbManifestSignature } from "../src/core/shared-kb";

test("builds manifest signatures and verifies them", async () => {
  await withTempRepo(async (repo) => {
    const source = join(repo, "shared-kb");
    const out = join(repo, "dist/shared-kb");
    await mkdir(join(source, "lessons"), { recursive: true });
    await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(validLesson())}\n`);
    const pair = generateKeyPairSync("ed25519");
    const privateKeyPath = join(repo, "private.pem");
    const publicKeyPath = join(repo, "public.pem");
    await writeFile(privateKeyPath, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
    await writeFile(publicKeyPath, pair.publicKey.export({ type: "spki", format: "pem" }));

    await buildSharedKbSnapshot({ source, out, privateKeyPath, publicKeyPath });

    expect(await verifySharedKbManifestSignature({
      manifestPath: join(out, "manifest.json"),
      signaturePath: join(out, "manifest.sig")
    })).toBe(true);

    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    manifest.counts.lessons = 99;
    await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    expect(await verifySharedKbManifestSignature({
      manifestPath: join(out, "manifest.json"),
      signaturePath: join(out, "manifest.sig")
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run signing test and verify missing signature support fails**

Run:

```bash
bun test tests/shared-kb.test.ts
```

Expected: FAIL with missing `verifySharedKbManifestSignature` export or unsupported `privateKeyPath` option.

- [ ] **Step 3: Implement signing support**

Modify imports in `src/core/shared-kb.ts`:

```ts
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
```

Change `buildSharedKbSnapshot` options to:

```ts
export async function buildSharedKbSnapshot(options: {
  source: string;
  out: string;
  privateKeyPath?: string;
  publicKeyPath?: string;
}): Promise<{ ok: true; out: string; published: number; manifest: SharedKbManifest }> {
```

After writing `manifest.json`, add:

```ts
  if (options.privateKeyPath && options.publicKeyPath) {
    await writeManifestSignature({
      manifestPath: join(options.out, "manifest.json"),
      signaturePath: join(options.out, "manifest.sig"),
      privateKeyPath: options.privateKeyPath,
      publicKeyPath: options.publicKeyPath,
    });
  }
```

Add these helpers to `src/core/shared-kb.ts`:

```ts
export interface SharedKbManifestSignature {
  algorithm: "ed25519";
  public_key: string;
  signature: string;
  signed_payload_sha256: string;
}

async function writeManifestSignature(options: {
  manifestPath: string;
  signaturePath: string;
  privateKeyPath: string;
  publicKeyPath: string;
}): Promise<void> {
  const manifestBytes = await readFile(options.manifestPath);
  const privateKey = createPrivateKey(await readFile(options.privateKeyPath, "utf8"));
  const publicKeyPem = await readFile(options.publicKeyPath, "utf8");
  const signature: SharedKbManifestSignature = {
    algorithm: "ed25519",
    public_key: Buffer.from(publicKeyPem).toString("base64"),
    signature: sign(null, manifestBytes, privateKey).toString("base64"),
    signed_payload_sha256: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
  };
  await writeText(options.signaturePath, `${JSON.stringify(signature, null, 2)}\n`);
}

export async function verifySharedKbManifestSignature(options: { manifestPath: string; signaturePath: string }): Promise<boolean> {
  const manifestBytes = await readFile(options.manifestPath);
  const signature = JSON.parse(await readFile(options.signaturePath, "utf8")) as SharedKbManifestSignature;
  if (signature.algorithm !== "ed25519") return false;
  const expectedHash = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;
  if (signature.signed_payload_sha256 !== expectedHash) return false;
  const publicKeyPem = Buffer.from(signature.public_key, "base64").toString("utf8");
  const publicKey = createPublicKey(publicKeyPem);
  return verify(null, manifestBytes, publicKey, Buffer.from(signature.signature, "base64"));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
bun test tests/shared-kb.test.ts
bun run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit signing support**

```bash
git add src/core/shared-kb.ts tests/shared-kb.test.ts
git commit -m "feat: sign shared kb manifests"
```

---

### Task 4: CLI Commands For Shared KB Packs

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli-kb.test.ts`
- Modify: `tests/cli-help.test.ts`

- [ ] **Step 1: Add failing CLI workflow tests**

Create `tests/cli-kb.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function runCli(repo: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { stdout, stderr, code };
}

function lesson(id = "lesson-20260603-a8f3"): Record<string, unknown> {
  return {
    id,
    kind: "anti_pattern",
    status: "trusted",
    title: "Treat handoffs as claims until validated",
    problem: "Agents may treat previous handoff summaries as proof of correctness.",
    applies_when: ["multi-agent coding workflow", "handoff records exist"],
    recommendation: "Record user-observed failures as contradiction events.",
    why: "This prevents stale claims from becoming canonical truth.",
    avoid_when: ["the source cannot be safely anonymized"],
    confidence: "high",
    evidence: {
      source_type: "anonymized_project_pattern",
      count: 1,
      has_follow_up_fix: true
    },
    tags: ["agents", "validation"],
    updated_at: "2026-06-03T10:00:00.000Z"
  };
}

describe("kb cli", () => {
  test("validates shared KB source directories", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson())}\n`);

      const result = await runCli(repo, ["kb", "validate", "--source", source]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Shared KB source is valid.");
      expect(result.stdout).toContain("1 lesson(s)");
    });
  });

  test("builds shared KB snapshots and searches trusted lessons", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      const out = join(repo, "dist/shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson())}\n`);

      const build = await runCli(repo, ["kb", "build", "--source", source, "--out", out]);
      expect(build.stderr).toBe("");
      expect(build.code).toBe(0);
      expect(build.stdout).toContain("Built shared KB snapshot at");
      expect(JSON.parse(await readFile(join(out, "manifest.json"), "utf8")).counts.lessons).toBe(1);

      const search = await runCli(repo, ["kb", "search", "--source", out, "--query", "handoff validation"]);
      expect(search.stderr).toBe("");
      expect(search.code).toBe(0);
      expect(search.stdout).toContain("lesson-20260603-a8f3");
      expect(search.stdout).toContain("Treat handoffs as claims until validated");
    });
  });

  test("json output is machine-readable", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson())}\n`);

      const result = await runCli(repo, ["kb", "validate", "--source", source, "--json"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.lessons).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Add failing help tests for missing KB flags**

Append to `tests/cli-help.test.ts`:

```ts
  test("kb validate without source shows command usage", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "validate"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Missing required --source");
      expect(result.stderr).toContain("barry-cache kb validate --source /path/to/shared-kb");
    });
  });
```

- [ ] **Step 3: Run CLI tests and verify missing `kb` command fails**

Run:

```bash
bun test tests/cli-kb.test.ts tests/cli-help.test.ts
```

Expected: FAIL with unknown `kb` command or missing usage text.

- [ ] **Step 4: Wire `kb` commands in `src/cli.ts`**

Add import:

```ts
import { buildSharedKbSnapshot, searchSharedKb, validateSharedKbSource } from "./core/shared-kb";
```

Add a `case` in `main`:

```ts
      case "kb": {
        await handleKbCommand(parsed, json);
        break;
      }
```

Add this function near other command handlers:

```ts
async function handleKbCommand(parsed: ParsedArgs, json: boolean): Promise<void> {
  const action = parsed.positionals[0];
  if (action === "validate") {
    const source = requiredString(parsed, "source", commandUsage("kb validate"));
    const result = await validateSharedKbSource({ source });
    print(result, json, result.ok
      ? `Shared KB source is valid. ${result.lessons.length} lesson(s), ${result.revocations.length} revocation(s).`
      : `Shared KB source has ${result.errors.length} error(s).`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === "build") {
    const source = requiredString(parsed, "source", commandUsage("kb build"));
    const out = requiredString(parsed, "out", commandUsage("kb build"));
    const privateKeyPath = optionalString(parsed, "private-key", commandUsage("kb build"));
    const publicKeyPath = optionalString(parsed, "public-key", commandUsage("kb build"));
    if ((privateKeyPath && !publicKeyPath) || (!privateKeyPath && publicKeyPath)) {
      throw new CliArgumentError("Use --private-key and --public-key together.", { usage: commandUsage("kb build") });
    }
    const result = await buildSharedKbSnapshot({ source, out, privateKeyPath, publicKeyPath });
    print(result, json, `Built shared KB snapshot at ${result.out} with ${result.published} lesson(s).`);
    return;
  }

  if (action === "search") {
    const source = requiredString(parsed, "source", commandUsage("kb search"));
    const query = requiredString(parsed, "query", commandUsage("kb search"));
    const result = await searchSharedKb({
      source,
      query,
      includeReviewed: parsed.flags.get("include-reviewed") === true,
    });
    print(result, json, formatKbSearchResults(result));
    return;
  }

  throw new CliArgumentError(action ? `Unknown KB action: ${action}` : "Missing KB action", {
    usage: commandUsage("kb"),
  });
}

function formatKbSearchResults(result: Awaited<ReturnType<typeof searchSharedKb>>): string {
  if (result.results.length === 0) return "No shared KB lessons matched.";
  return result.results.map((item) => [
    `${item.id}  ${item.status}  ${item.title}`,
    `  ${item.summary}`,
    `  tags: ${item.tags.join(", ")}`,
  ].join("\n")).join("\n");
}
```

Update `commandUsage` entries:

```ts
    kb: "barry-cache kb <validate|build|search> [--json]",
    "kb validate": "barry-cache kb validate --source /path/to/shared-kb [--json]",
    "kb build": "barry-cache kb build --source /path/to/shared-kb --out /path/to/dist [--private-key private.pem --public-key public.pem] [--json]",
    "kb search": 'barry-cache kb search --source /path-or-url --query "..." [--include-reviewed] [--json]',
```

Update `usageText()` to include:

```text
  barry-cache kb validate --source /path/to/shared-kb [--json]
  barry-cache kb build --source /path/to/shared-kb --out /path/to/dist [--json]
  barry-cache kb search --source /path-or-url --query "..." [--json]
```

- [ ] **Step 5: Run CLI tests and typecheck**

Run:

```bash
bun test tests/cli-kb.test.ts tests/cli-help.test.ts
bun run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit CLI support**

```bash
git add src/cli.ts tests/cli-kb.test.ts tests/cli-help.test.ts
git commit -m "feat: add shared kb cli commands"
```

---

### Task 5: Cloudflare Static Distribution Guide

**Files:**
- Create: `docs/shared-kb-cloudflare.md`
- Modify: `README.md`

- [ ] **Step 1: Add Cloudflare guide**

Create `docs/shared-kb-cloudflare.md`:

```md
# Shared KB Cloudflare Distribution

Barry shared KB v1 uses Git as the contribution and review path, then publishes signed static snapshots for cheap distribution.

## Source Layout

```text
shared-kb/
  lessons/*.jsonl
  revocations.jsonl
```

Lessons are anonymized advice records. They are not repo-local Barry facts and they must not contain project names, private file paths, customer names, secrets, stack traces, or full code dumps.

## Build Snapshot

```bash
bun run barry -- kb validate --source shared-kb
bun run barry -- kb build --source shared-kb --out dist/shared-kb --private-key private.pem --public-key public.pem
```

The build writes:

```text
dist/shared-kb/
  lessons/lessons.jsonl
  revocations.jsonl
  indexes/search-index.json
  manifest.json
  manifest.sig
```

## Publish To Cloudflare R2

Use Wrangler from the shared KB repository:

```bash
npx wrangler r2 bucket create barry-solutions-kb
npx wrangler r2 object put barry-solutions-kb/latest/manifest.json --file dist/shared-kb/manifest.json
npx wrangler r2 object put barry-solutions-kb/latest/manifest.sig --file dist/shared-kb/manifest.sig
npx wrangler r2 object put barry-solutions-kb/latest/indexes/search-index.json --file dist/shared-kb/indexes/search-index.json
npx wrangler r2 object put barry-solutions-kb/latest/lessons/lessons.jsonl --file dist/shared-kb/lessons/lessons.jsonl
npx wrangler r2 object put barry-solutions-kb/latest/revocations.jsonl --file dist/shared-kb/revocations.jsonl
```

Expose the R2 objects through a Cloudflare Worker route or a public bucket domain. Barry clients can then search with:

```bash
barry-cache kb search --source https://kb.example.com/latest --query "validation failures"
```

## Publish Static Pages

Cloudflare Pages can host documentation and a generated search UI later. The first version only needs the static snapshot files above.

## Trust Rules

- `trusted` lessons are included in default search.
- `reviewed` lessons are included only when the client passes `--include-reviewed`.
- `submitted`, `quarantined`, and `rejected` lessons are not published.
- Lessons targeted by `revoked` records are removed from the generated search index.
- Bad accepted lessons must be challenged or revoked through `revocations.jsonl`, then a new signed snapshot must be published.

## Abuse Handling

Keep community submissions in Git PRs. Automated checks should run:

```bash
bun run barry -- kb validate --source shared-kb
```

Maintainers should reject records that are not anonymized, lack applicability, lack rationale, or claim universal correctness.
```

- [ ] **Step 2: Link the guide from `README.md`**

Add a short link near the existing Barry command documentation:

```md
Shared/community solutions KB publishing is documented in [Shared KB Cloudflare Distribution](docs/shared-kb-cloudflare.md).
```

- [ ] **Step 3: Run docs-adjacent tests**

Run:

```bash
bun test tests/cli-kb.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit docs**

```bash
git add docs/shared-kb-cloudflare.md README.md
git commit -m "docs: document shared kb cloudflare publishing"
```

---

### Task 6: Barry Canonical Context And ADR

**Files:**
- Create: `docs/context/features/shared-kb/README.md`
- Create: `docs/context/features/shared-kb/IDMAP.md`
- Create: `docs/context/features/shared-kb/KG.adj`
- Create: `docs/context/features/shared-kb/FACTS.jsonl`
- Create through CLI: `docs/context/adrs/ADR-0007-store-shared-solutions-kb-as-signed-static-packs.md`

- [ ] **Step 1: Create ADR for the storage decision**

Run:

```bash
bun run barry -- adr new --title "Store shared solutions KB as signed static packs" --tags "shared-kb,storage,cloudflare,agents"
```

Expected: creates the next ADR file. If the generated ID is not `ADR-0007`, use the generated path in the fact below and keep the title unchanged.

- [ ] **Step 2: Create shared KB feature context pack**

Create `docs/context/features/shared-kb/README.md`:

```md
# Shared KB

Owns Barry shared/community solutions KB behavior, including anonymized lesson schemas, static snapshot building, manifest signatures, search over generated shared KB indexes, Cloudflare-oriented publishing docs, and trust-state rules for reviewed and trusted community lessons.

Use this pack for changes to `barry-cache kb`, shared KB JSONL validation, signed manifests, shared KB search, revocation handling, or shared solutions KB publishing docs.
```

Create `docs/context/features/shared-kb/IDMAP.md`:

```md
# ID Map

- `SHARED_KB_CORE`: src/core/shared-kb.ts
- `CLI`: src/cli.ts
- `SHARED_KB_TEST`: tests/shared-kb.test.ts
- `CLI_KB_TEST`: tests/cli-kb.test.ts
- `CLI_HELP_TEST`: tests/cli-help.test.ts
- `SHARED_KB_DOC`: docs/shared-kb-cloudflare.md
- `SHARED_KB_ADR`: docs/context/adrs/ADR-0007-store-shared-solutions-kb-as-signed-static-packs.md
- `README`: README.md
```

Create `docs/context/features/shared-kb/KG.adj`:

```text
shared-kb validates anonymized-lessons
shared-kb builds signed-static-snapshots
shared-kb publishes through cloudflare-r2-pages
shared-kb search uses generated-index
revocations remove trusted-lessons
git-pr-review gates published-lessons
```

Create `docs/context/features/shared-kb/FACTS.jsonl`:

```jsonl
{"id":"SKB-20260603T120000Z-a8f3","subject":"Barry shared KB","predicate":"stores","object":"community solution lessons as anonymized JSONL source records that are reviewed through Git before publication","src":["SHARED_KB_CORE","SHARED_KB_TEST","SHARED_KB_ADR"],"status":"active","kind":"decision","updated_at":"2026-06-03T12:00:00.000Z","confidence":"high","tags":["shared-kb","storage","privacy"]}
{"id":"SKB-20260603T120100Z-b4d1","subject":"Shared KB snapshots","predicate":"generate","object":"manifest, manifest signature, lesson JSONL, revocation JSONL, and search index files for static Cloudflare Pages or R2 distribution","src":["SHARED_KB_CORE","CLI_KB_TEST","SHARED_KB_DOC"],"status":"active","kind":"implemented","updated_at":"2026-06-03T12:01:00.000Z","confidence":"high","tags":["shared-kb","cloudflare","publishing"]}
{"id":"SKB-20260603T120200Z-c7e2","subject":"Shared KB search","predicate":"defaults to","object":"trusted lessons while allowing reviewed lessons only through an explicit include-reviewed option","src":["SHARED_KB_CORE","CLI","SHARED_KB_TEST","CLI_KB_TEST"],"status":"active","kind":"implemented","updated_at":"2026-06-03T12:02:00.000Z","confidence":"high","tags":["shared-kb","trust","search"]}
{"id":"SKB-20260603T120300Z-d9f6","subject":"Shared KB validation","predicate":"rejects","object":"revealing file paths, email addresses, secret-looking tokens, malformed records, and duplicate lesson IDs before publication","src":["SHARED_KB_CORE","SHARED_KB_TEST"],"status":"active","kind":"implemented","updated_at":"2026-06-03T12:03:00.000Z","confidence":"high","tags":["shared-kb","validation","privacy"]}
```

If the ADR generated in Step 1 is not `ADR-0007`, update `SHARED_KB_ADR` in `IDMAP.md` and the `src` value in the first fact before validating.

- [ ] **Step 3: Run Barry context validation**

Run:

```bash
bun run barry -- validate
```

Expected: PASS with "Barry Cache context is valid."

- [ ] **Step 4: Commit canonical context**

```bash
git add docs/context/features/shared-kb docs/context/adrs docs/context/LOG.md
git commit -m "docs: record shared kb architecture"
```

---

### Task 7: Full Verification And Handoff

**Files:**
- Verify all files touched by Tasks 1-6.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test tests/shared-kb.test.ts tests/cli-kb.test.ts tests/cli-help.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run Barry validation**

Run:

```bash
bun run barry -- validate
```

Expected: PASS.

- [ ] **Step 5: Record operational handoff**

Run:

```bash
bun run barry -- finalize --status success --summary "Implemented shared solutions KB static pack support with validation, signed manifests, CLI build/search commands, Cloudflare publishing docs, and source-backed Barry context." --files "src/core/shared-kb.ts,src/cli.ts,tests/shared-kb.test.ts,tests/cli-kb.test.ts,docs/shared-kb-cloudflare.md,docs/context/features/shared-kb/FACTS.jsonl"
```

Expected: prints that operational handoff was saved to `.context-state/handoffs/handoffs.jsonl`.

---

## Self-Review

- **Spec coverage:** The plan covers Git-reviewed JSONL source records, generated static snapshot files, signed manifests, Cloudflare Pages/R2 publishing guidance, trust-state filtering, revocation handling, default trusted-only search, abuse containment through validation/review, and Barry canonical context updates.
- **Scope containment:** Direct API submissions, D1 queues, votes, badges, and live moderation are intentionally excluded because they are separate subsystems.
- **Type consistency:** Shared KB types are introduced in Task 1, extended in Tasks 2-3, and imported by CLI tests and CLI handlers in Task 4 using the same function names.
- **Verification:** The plan ends with targeted tests, full suite, typecheck, Barry validate, and operational finalize.
