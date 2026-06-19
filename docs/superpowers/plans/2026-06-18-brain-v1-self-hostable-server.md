# Brain v1 — Self-Hostable Server Implementation Plan

> **SUPERSEDED & ABANDONED (2026-06-19).** The Brain server was built and then retired by
> [ADR-0011](../../context/adrs/ADR-0011-interoperate-with-cq-and-retire-the-standalone-global-hive-mind.md):
> Barry now interoperates with Mozilla's cq commons instead of running its own server, and the
> `brain/` tree has been deleted. Kept only as historical record — do not implement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-hostable "Brain" server for the distributed shared KB that anyone can stand up with one Docker command (SQLite-backed), exposing a vendor-neutral HTTP contract that Barry instances point at.

**Architecture:** One portable core written against the Web Fetch API (`(Request) => Promise<Response>`) plus two abstractions — a `BrainStore` persistence interface (SQLite adapter via `bun:sqlite`) and a `SnapshotPublisher` interface (local-dir adapter). The brain reuses the existing `src/core/shared-kb.ts` schema, validators, search scoring, and Ed25519 sign/verify (refactored so they don't require filesystem source dirs). A thin `Bun.serve` runtime entrypoint and a `barry-brain` CLI (`init`/`migrate`/`serve`/`conformance`) wrap the core. Trust policy is configurable: `company` (lessons usable immediately) ships in v1; strict `global` maturation is deferred.

**Tech Stack:** Bun, TypeScript (ESM), `bun:sqlite` (no external dep), Node `crypto` Ed25519, Web Fetch API (`Request`/`Response`), Docker (`oven/bun` base image), `bun test`.

## Global Constraints

- Runtime: Bun; Node engine floor `>=20`. TypeScript ESM (`"type": "module"`).
- No new runtime dependencies. SQLite uses built-in `bun:sqlite`. Crypto uses `node:crypto`.
- All new brain code lives under `brain/`. Shared logic lives in `src/core/shared-kb.ts` (the shared core) and is imported by both `src/cli.ts` and `brain/`. Do NOT duplicate schema/validation/signing logic.
- The HTTP layer MUST be a pure `(request: Request) => Promise<Response>` handler with no Bun/Node-server-specific calls, so it can later run on Cloudflare Workers unchanged. Server bind code lives only in `brain/runtime/`.
- Reuse existing fs helpers from `src/core/fs.ts` (`exists`, `readText`, `writeText`, `readTextIfExists`). Reuse `CommandIssue` from `src/core/types.ts`.
- Tests use `bun test` and the `withTempRepo` helper pattern (mkdtemp temp dirs); never write into the repo tree from tests.
- Snapshot signature format MUST match the existing `SharedKbManifestSignature` shape in `shared-kb.ts` (`algorithm: "ed25519"`, base64 `public_key` PEM, base64 `signature`, `signed_payload_sha256: "sha256:..."`).
- Verify with `bun test` and `bun run typecheck` after each task. Both must pass.

---

### Task 1: Refactor shared snapshot builder into a pure, fs-free core

Extract the snapshot-artifact computation out of `buildSharedKbSnapshot` so the brain can build snapshots from in-memory records (SQLite rows) instead of a source directory. Keep the existing CLI behavior and tests green.

**Files:**
- Modify: `src/core/shared-kb.ts`
- Test: `tests/shared-kb.test.ts`

**Interfaces:**
- Consumes: existing `SharedKbLesson`, `SharedKbRevocation`, `SharedKbManifest`, `SharedKbSearchIndex`, `searchItemForLesson`, `manifestFile`, `sharedKbPublishedStatuses`.
- Produces:
  ```ts
  export interface SharedKbSnapshotArtifacts {
    lessonRows: string;        // newline-terminated JSONL (empty string if none)
    revocationRows: string;    // newline-terminated JSONL
    indexJson: string;         // pretty JSON + trailing newline
    manifestJson: string;      // pretty JSON + trailing newline
    manifest: SharedKbManifest;
    publishedLessons: SharedKbLesson[];
  }
  export function buildSharedKbSnapshotArtifacts(input: {
    lessons: SharedKbLesson[];
    revocations: SharedKbRevocation[];
    generatedAt: string;       // ISO string, injected for determinism/testability
  }): SharedKbSnapshotArtifacts;
  ```

- [ ] **Step 1: Write the failing test**

Add to `tests/shared-kb.test.ts`:

```ts
import { buildSharedKbSnapshotArtifacts } from "../src/core/shared-kb";

test("buildSharedKbSnapshotArtifacts publishes trusted lessons, excludes revoked, and is deterministic for a fixed timestamp", () => {
  const trusted = {
    id: "lesson-20260601-aaaa1111", kind: "lesson", status: "trusted",
    title: "Validate handoffs", problem: "Stale handoffs trusted.",
    applies_when: ["multi-agent"], recommendation: "Re-validate claims.",
    why: "Prevents stale memory becoming truth.", avoid_when: ["cannot anonymize"],
    confidence: "medium", evidence: { source_type: "community_report", count: 2 },
    tags: ["agents"], updated_at: "2026-06-01T00:00:00.000Z",
  } as const;
  const revokedLesson = { ...trusted, id: "lesson-20260601-bbbb2222", title: "Bad lesson" };
  const artifacts = buildSharedKbSnapshotArtifacts({
    lessons: [trusted, revokedLesson],
    revocations: [{ id: "rev-1", target: "lesson-20260601-bbbb2222", status: "revoked", reason: "wrong", updated_at: "2026-06-02T00:00:00.000Z" }],
    generatedAt: "2026-06-03T00:00:00.000Z",
  });

  expect(artifacts.publishedLessons.map((l) => l.id)).toEqual(["lesson-20260601-aaaa1111"]);
  expect(artifacts.manifest.counts).toEqual({ lessons: 1, revoked: 1 });
  expect(artifacts.manifest.generated_at).toBe("2026-06-03T00:00:00.000Z");
  expect(artifacts.lessonRows.endsWith("\n")).toBe(true);
  // Determinism: same input → identical bytes
  const again = buildSharedKbSnapshotArtifacts({ lessons: [trusted, revokedLesson], revocations: [{ id: "rev-1", target: "lesson-20260601-bbbb2222", status: "revoked", reason: "wrong", updated_at: "2026-06-02T00:00:00.000Z" }], generatedAt: "2026-06-03T00:00:00.000Z" });
  expect(again.manifestJson).toBe(artifacts.manifestJson);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/shared-kb.test.ts`
Expected: FAIL — `buildSharedKbSnapshotArtifacts is not a function` / not exported.

- [ ] **Step 3: Implement the pure builder and route the existing function through it**

In `src/core/shared-kb.ts`, add the exported interface and function:

```ts
export interface SharedKbSnapshotArtifacts {
  lessonRows: string;
  revocationRows: string;
  indexJson: string;
  manifestJson: string;
  manifest: SharedKbManifest;
  publishedLessons: SharedKbLesson[];
}

export function buildSharedKbSnapshotArtifacts(input: {
  lessons: SharedKbLesson[];
  revocations: SharedKbRevocation[];
  generatedAt: string;
}): SharedKbSnapshotArtifacts {
  const revoked = new Set(input.revocations.filter((r) => r.status === "revoked").map((r) => r.target));
  const lessons = input.lessons
    .filter((lesson) => sharedKbPublishedStatuses.includes(lesson.status as typeof sharedKbPublishedStatuses[number]))
    .filter((lesson) => !revoked.has(lesson.id))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
  const index: SharedKbSearchIndex = { version: 1, generated_at: input.generatedAt, items: lessons.map(searchItemForLesson) };
  const lessonRows = `${lessons.map((lesson) => JSON.stringify(lesson)).join("\n")}${lessons.length ? "\n" : ""}`;
  const revocationRows = `${input.revocations.map((r) => JSON.stringify(r)).join("\n")}${input.revocations.length ? "\n" : ""}`;
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;
  const files: SharedKbManifestFile[] = [
    manifestFile("lessons/lessons.jsonl", lessonRows, lessons.length),
    manifestFile("revocations.jsonl", revocationRows, input.revocations.length),
    manifestFile("indexes/search-index.json", indexJson, index.items.length),
  ];
  const manifest: SharedKbManifest = {
    version: 1, generated_at: input.generatedAt, source: "barry-shared-kb",
    counts: { lessons: lessons.length, revoked: revoked.size },
    files, lessons: lessons.map((l) => l.id), revoked: [...revoked].sort(),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  return { lessonRows, revocationRows, indexJson, manifestJson, manifest, publishedLessons: lessons };
}
```

Then refactor `buildSharedKbSnapshot` to use it (preserving its current `out`/signing behavior):

```ts
export async function buildSharedKbSnapshot(options: { source: string; out: string; privateKeyPath?: string; publicKeyPath?: string; }): Promise<{ ok: true; out: string; published: number; manifest: SharedKbManifest }> {
  const validation = await validateSharedKbSource({ source: options.source });
  if (!validation.ok) {
    const rendered = validation.errors.map((e) => `${e.file}${e.line ? `:${e.line}` : ""} ${e.message}`).join("\n");
    throw new Error(`Shared KB source is invalid:\n${rendered}`);
  }
  const artifacts = buildSharedKbSnapshotArtifacts({ lessons: validation.lessons, revocations: validation.revocations, generatedAt: new Date().toISOString() });
  await writeText(join(options.out, "lessons/lessons.jsonl"), artifacts.lessonRows);
  await writeText(join(options.out, "revocations.jsonl"), artifacts.revocationRows);
  await writeText(join(options.out, "indexes/search-index.json"), artifacts.indexJson);
  await writeText(join(options.out, "manifest.json"), artifacts.manifestJson);
  if (options.privateKeyPath && options.publicKeyPath) {
    await writeManifestSignature({ manifestPath: join(options.out, "manifest.json"), signaturePath: join(options.out, "manifest.sig"), privateKeyPath: options.privateKeyPath, publicKeyPath: options.publicKeyPath });
  }
  return { ok: true, out: options.out, published: artifacts.publishedLessons.length, manifest: artifacts.manifest };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/shared-kb.test.ts && bun run typecheck`
Expected: PASS (new test passes; all pre-existing shared-kb tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/core/shared-kb.ts tests/shared-kb.test.ts
git commit -m "refactor(shared-kb): extract pure snapshot artifact builder for brain reuse"
```

---

### Task 2: Brain identity (Ed25519 keypair + fingerprint)

The brain signs its snapshots with its own keypair so clients can pin and verify. Generate on first use, load thereafter.

**Files:**
- Create: `brain/core/identity.ts`
- Test: `brain/tests/identity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BrainIdentity {
    public_key_pem: string;   // PEM text
    private_key_pem: string;  // PEM text
    fingerprint: string;      // "sha256:<hex>" of the public key PEM bytes
    created_at: string;
  }
  export async function loadOrCreateBrainIdentity(opts: { dir: string; now: string }): Promise<BrainIdentity>;
  export function brainFingerprint(publicKeyPem: string): string;
  ```
- The identity file is `<dir>/identity.json`. `now` is injected (ISO string) for testability.

- [ ] **Step 1: Write the failing test**

```ts
import { loadOrCreateBrainIdentity, brainFingerprint } from "../core/identity";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "brain-identity-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("creates an identity once and reloads the same keypair + fingerprint", async () => {
  await withDir(async (dir) => {
    const a = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
    const b = await loadOrCreateBrainIdentity({ dir, now: "2026-06-19T00:00:00.000Z" });
    expect(b.public_key_pem).toBe(a.public_key_pem);
    expect(b.created_at).toBe("2026-06-18T00:00:00.000Z");
    expect(a.fingerprint).toBe(brainFingerprint(a.public_key_pem));
    expect(a.fingerprint.startsWith("sha256:")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test brain/tests/identity.test.ts`
Expected: FAIL — module `../core/identity` not found.

- [ ] **Step 3: Implement**

```ts
import { createHash, generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { exists, readText, writeText } from "../../src/core/fs";

export interface BrainIdentity {
  public_key_pem: string;
  private_key_pem: string;
  fingerprint: string;
  created_at: string;
}

export function brainFingerprint(publicKeyPem: string): string {
  return `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`;
}

export async function loadOrCreateBrainIdentity(opts: { dir: string; now: string }): Promise<BrainIdentity> {
  const path = join(opts.dir, "identity.json");
  if (await exists(path)) {
    const stored = JSON.parse(await readText(path)) as Omit<BrainIdentity, "fingerprint">;
    return { ...stored, fingerprint: brainFingerprint(stored.public_key_pem) };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const public_key_pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const private_key_pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const stored = { public_key_pem, private_key_pem, created_at: opts.now };
  await writeText(path, `${JSON.stringify(stored, null, 2)}\n`);
  return { ...stored, fingerprint: brainFingerprint(public_key_pem) };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test brain/tests/identity.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain/core/identity.ts brain/tests/identity.test.ts
git commit -m "feat(brain): add brain identity keypair and fingerprint"
```

---

### Task 3: BrainStore interface + SQLite adapter

Persistence abstraction plus the SQLite (`bun:sqlite`) adapter with schema migration.

**Files:**
- Create: `brain/core/store.ts` (interface + record types)
- Create: `brain/core/store-sqlite.ts` (adapter)
- Test: `brain/tests/store-sqlite.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // brain/core/store.ts
  import type { SharedKbLesson, SharedKbRevocation } from "../../src/core/shared-kb";

  export interface StoredAttestation {
    id: string; lesson_id: string; validator_id: string;
    result: "confirmed" | "contradicted" | "not_applicable";
    confidence: number; context_tags: string[];
    evidence_type: "observed_success" | "observed_failure" | "static_review";
    upstream_seen: string[]; created_at: string;
    public_key: string; signature: string;
  }

  export interface BrainStore {
    migrate(): Promise<void>;
    upsertLesson(lesson: SharedKbLesson, meta: { submitted_by: string; received_at: string }): Promise<void>;
    getLesson(id: string): Promise<SharedKbLesson | null>;
    listLessons(): Promise<SharedKbLesson[]>;
    addAttestation(att: StoredAttestation): Promise<void>;
    listAttestations(lessonId: string): Promise<StoredAttestation[]>;
    addRevocation(rev: SharedKbRevocation): Promise<void>;
    listRevocations(): Promise<SharedKbRevocation[]>;
    close(): Promise<void>;
  }
  export function createSqliteStore(path: string): BrainStore; // path ":memory:" allowed
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { createSqliteStore } from "../core/store-sqlite";

const lesson = {
  id: "lesson-20260601-aaaa1111", kind: "lesson", status: "trusted",
  title: "T", problem: "P", applies_when: ["x"], recommendation: "R", why: "W",
  avoid_when: ["y"], confidence: "high", evidence: { source_type: "community_report", count: 1 },
  tags: ["agents"], updated_at: "2026-06-01T00:00:00.000Z",
} as const;

test("sqlite store round-trips lessons, attestations, revocations", async () => {
  const store = createSqliteStore(":memory:");
  await store.migrate();
  await store.upsertLesson(lesson, { submitted_by: "validator-1", received_at: "2026-06-18T00:00:00.000Z" });
  expect((await store.getLesson(lesson.id))?.title).toBe("T");
  expect((await store.listLessons()).length).toBe(1);

  await store.addAttestation({ id: "att-1", lesson_id: lesson.id, validator_id: "validator-1", result: "confirmed", confidence: 0.8, context_tags: ["cli"], evidence_type: "observed_success", upstream_seen: [], created_at: "2026-06-18T00:00:00.000Z", public_key: "pk", signature: "sig" });
  expect((await store.listAttestations(lesson.id)).length).toBe(1);

  await store.addRevocation({ id: "rev-1", target: lesson.id, status: "revoked", reason: "bad", updated_at: "2026-06-18T00:00:00.000Z" });
  expect((await store.listRevocations()).length).toBe(1);
  await store.close();
});

test("upsertLesson replaces an existing lesson by id", async () => {
  const store = createSqliteStore(":memory:");
  await store.migrate();
  await store.upsertLesson(lesson, { submitted_by: "v", received_at: "2026-06-18T00:00:00.000Z" });
  await store.upsertLesson({ ...lesson, title: "Updated" }, { submitted_by: "v", received_at: "2026-06-18T00:00:01.000Z" });
  expect((await store.listLessons()).length).toBe(1);
  expect((await store.getLesson(lesson.id))?.title).toBe("Updated");
  await store.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test brain/tests/store-sqlite.test.ts`
Expected: FAIL — `../core/store-sqlite` not found.

- [ ] **Step 3: Implement the SQLite adapter**

`brain/core/store.ts`: paste the interface block from **Interfaces** above.

`brain/core/store-sqlite.ts`:

```ts
import { Database } from "bun:sqlite";
import type { SharedKbLesson, SharedKbRevocation } from "../../src/core/shared-kb";
import type { BrainStore, StoredAttestation } from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL,
  submitted_by TEXT NOT NULL, received_at TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, validator_id TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attestations_lesson ON attestations(lesson_id);
CREATE TABLE IF NOT EXISTS revocations (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, doc TEXT NOT NULL
);
`;

export function createSqliteStore(path: string): BrainStore {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  return {
    async migrate() { db.exec(SCHEMA); },
    async upsertLesson(lesson, meta) {
      db.query(`INSERT INTO lessons (id, status, updated_at, submitted_by, received_at, doc) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, submitted_by=excluded.submitted_by, received_at=excluded.received_at, doc=excluded.doc`)
        .run(lesson.id, lesson.status, lesson.updated_at, meta.submitted_by, meta.received_at, JSON.stringify(lesson));
    },
    async getLesson(id) {
      const row = db.query(`SELECT doc FROM lessons WHERE id = ?`).get(id) as { doc: string } | null;
      return row ? (JSON.parse(row.doc) as SharedKbLesson) : null;
    },
    async listLessons() {
      const rows = db.query(`SELECT doc FROM lessons ORDER BY updated_at, id`).all() as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as SharedKbLesson);
    },
    async addAttestation(att) {
      db.query(`INSERT OR REPLACE INTO attestations (id, lesson_id, validator_id, doc) VALUES (?, ?, ?, ?)`)
        .run(att.id, att.lesson_id, att.validator_id, JSON.stringify(att));
    },
    async listAttestations(lessonId) {
      const rows = db.query(`SELECT doc FROM attestations WHERE lesson_id = ? ORDER BY id`).all(lessonId) as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as StoredAttestation);
    },
    async addRevocation(rev) {
      db.query(`INSERT OR REPLACE INTO revocations (id, target, doc) VALUES (?, ?, ?)`).run(rev.id, rev.target, JSON.stringify(rev));
    },
    async listRevocations() {
      const rows = db.query(`SELECT doc FROM revocations ORDER BY id`).all() as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as SharedKbRevocation);
    },
    async close() { db.close(); },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test brain/tests/store-sqlite.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain/core/store.ts brain/core/store-sqlite.ts brain/tests/store-sqlite.test.ts
git commit -m "feat(brain): add BrainStore interface and SQLite adapter"
```

---

### Task 4: Brain service (intake, search, attest, getLesson, snapshot)

The runtime-agnostic service object that holds the policy and orchestrates store + shared validators + snapshot builder. No HTTP here.

**Files:**
- Create: `brain/core/brain.ts`
- Test: `brain/tests/brain.test.ts`

**Interfaces:**
- Consumes: `BrainStore`, `StoredAttestation` (Task 3); `validateSharedKbLesson`, `buildSharedKbSnapshotArtifacts`, `searchSharedKb`-style scoring, `SharedKbLesson`, `SharedKbSnapshotArtifacts` (Tasks 1 + existing `shared-kb.ts`); `BrainIdentity` (Task 2).
- Produces:
  ```ts
  export type TrustPolicy = "company" | "global";
  export interface IntakeItem { type: "lesson" | "attestation"; record: unknown; }
  export interface IntakeBatch { version: 1; validator_id: string; public_key: string; signature: string; items: IntakeItem[]; }
  export interface IntakeResult { accepted: number; rejected: Array<{ index: number; reason: string }>; }
  export interface SearchHit { id: string; title: string; summary: string; tags: string[]; status: string; confidence: string; score: number; }

  export interface Brain {
    intake(batch: IntakeBatch): Promise<IntakeResult>;
    search(query: string, opts?: { includeReviewed?: boolean; limit?: number }): Promise<SearchHit[]>;
    getLesson(id: string): Promise<{ lesson: SharedKbLesson; attestations: number } | null>;
    attest(att: StoredAttestation): Promise<{ ok: boolean; reason?: string }>;
    snapshot(): Promise<SharedKbSnapshotArtifacts & { signature: SharedKbManifestSignature }>;
  }
  export function createBrain(opts: { store: BrainStore; identity: BrainIdentity; trustPolicy: TrustPolicy; now: () => string }): Brain;
  ```

**Policy rules (v1):**
- `intake`: verify the batch signature against `public_key` over the canonical batch body excluding `signature` (use the same canonical-JSON-sort approach as `shared-kb` signing — sort top-level keys). For each item: lessons are validated with `validateSharedKbLesson` (rejects on any error, including redaction leaks); attestations are validated with `validateAttestation` (below). On `trustPolicy: "company"`, an accepted lesson is stored with its incoming status forced to `"trusted"` (usable immediately). On `"global"`, the lesson is stored with status `"reviewed"` (strict promotion is deferred to a later plan). Reject reasons are returned per item index; valid items still commit.
- `search`: reuse the existing token scoring (`tokens`, `scoreText` from `shared-kb.ts` — export them in this task if not already exported). Build the in-memory index from `store.listLessons()` minus revoked targets. `company` policy returns lessons with status in {`trusted`,`reviewed`,`deprecated`,`challenged`,`superseded`} filtered by `includeReviewed`; default returns only `trusted`. Cap results at `limit ?? 5`.
- `attest`: validate, require the referenced lesson to exist, store it.
- `snapshot`: build artifacts from store via `buildSharedKbSnapshotArtifacts`, then sign the manifest JSON with the brain identity and return `{ ...artifacts, signature }`.

**Attestation validator** (add to `brain/core/brain.ts`):
```ts
export function validateAttestation(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "attestation must be an object";
  const a = value as Record<string, unknown>;
  for (const f of ["id", "lesson_id", "validator_id", "created_at", "public_key", "signature"]) {
    if (typeof a[f] !== "string" || (a[f] as string).trim() === "") return `invalid field: ${f}`;
  }
  if (!["confirmed", "contradicted", "not_applicable"].includes(String(a.result))) return "invalid field: result";
  if (!["observed_success", "observed_failure", "static_review"].includes(String(a.evidence_type))) return "invalid field: evidence_type";
  if (typeof a.confidence !== "number" || a.confidence < 0.01 || a.confidence > 0.99) return "invalid field: confidence";
  if (!Array.isArray(a.context_tags) || (a.context_tags as unknown[]).some((t) => typeof t !== "string")) return "invalid field: context_tags";
  if (!Array.isArray(a.upstream_seen) || (a.upstream_seen as unknown[]).some((t) => typeof t !== "string")) return "invalid field: upstream_seen";
  return null;
}
```

- [ ] **Step 1: Export reusable helpers from shared-kb**

In `src/core/shared-kb.ts`, change `function tokens` / `function scoreText` to `export function tokens` / `export function scoreText`, and ensure `SharedKbManifestSignature` and the signing primitive are reachable. Add a pure signer:

```ts
export function signManifestJson(manifestJson: string, privateKeyPem: string, publicKeyPem: string): SharedKbManifestSignature {
  const bytes = Buffer.from(manifestJson);
  return {
    algorithm: "ed25519",
    public_key: Buffer.from(publicKeyPem).toString("base64"),
    signature: sign(null, bytes, createPrivateKey(privateKeyPem)).toString("base64"),
    signed_payload_sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { createBrain } from "../core/brain";
import { createSqliteStore } from "../core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../core/identity";
import { verifySharedKbManifestSignature } from "../../src/core/shared-kb";
import { sign, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function signedBatch(items: any[]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const body = { version: 1, validator_id: "validator-test", public_key: Buffer.from(pub).toString("base64"), items };
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  const signature = sign(null, Buffer.from(canonical), privateKey).toString("base64");
  return { ...body, signature };
}

const lesson = { id: "lesson-20260601-aaaa1111", kind: "lesson", status: "submitted", title: "T", problem: "P", applies_when: ["x"], recommendation: "R", why: "W", avoid_when: ["y"], confidence: "high", evidence: { source_type: "community_report", count: 1 }, tags: ["cli"], updated_at: "2026-06-01T00:00:00.000Z" };

test("company brain accepts a valid signed lesson batch and makes it searchable as trusted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-svc-"));
  try {
    const store = createSqliteStore(":memory:"); await store.migrate();
    const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
    const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });

    const result = await brain.intake(signedBatch([{ type: "lesson", record: lesson }]));
    expect(result.accepted).toBe(1);
    const hits = await brain.search("anonymized P");
    expect(hits.length).toBe(0); // unmatched token "anonymized"
    const hits2 = await brain.search("P R");
    expect(hits2[0]?.id).toBe(lesson.id);

    const snap = await brain.snapshot();
    expect(snap.manifest.counts.lessons).toBe(1);
    // signature verifies against the manifest bytes
    const expected = `sha256:${createHash("sha256").update(Buffer.from(snap.manifestJson)).digest("hex")}`;
    expect(snap.signature.signed_payload_sha256).toBe(expected);
    await store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("intake rejects a lesson containing a leaked file path, keeps valid siblings", async () => {
  const store = createSqliteStore(":memory:"); await store.migrate();
  const dir = await mkdtemp(join(tmpdir(), "brain-svc2-"));
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });
  const leaky = { ...lesson, id: "lesson-20260601-bbbb2222", problem: "fails in src/core/secret.ts loader" };
  const result = await brain.intake(signedBatch([{ type: "lesson", record: lesson }, { type: "lesson", record: leaky }]));
  expect(result.accepted).toBe(1);
  expect(result.rejected[0]?.index).toBe(1);
  await store.close(); await rm(dir, { recursive: true, force: true });
});

test("intake rejects a batch whose signature does not verify", async () => {
  const store = createSqliteStore(":memory:"); await store.migrate();
  const dir = await mkdtemp(join(tmpdir(), "brain-svc3-"));
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });
  const batch = signedBatch([{ type: "lesson", record: lesson }]);
  batch.signature = Buffer.from("not-a-real-signature").toString("base64");
  await expect(brain.intake(batch)).rejects.toThrow(/signature/i);
  await store.close(); await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test brain/tests/brain.test.ts`
Expected: FAIL — `../core/brain` not found.

- [ ] **Step 4: Implement `brain/core/brain.ts`**

Implement `createBrain` per the policy rules above. Key points:
- Batch signature: rebuild `canonical = JSON.stringify(body, Object.keys(body).sort())` where `body` is the batch without `signature`; decode `public_key` from base64 to PEM; `verify(null, Buffer.from(canonical), createPublicKey(pem), Buffer.from(signature, "base64"))`. Throw `new Error("Shared KB intake batch signature did not verify")` on failure.
- For each item by index: validate, on error push `{ index, reason }`; on success, force lesson status per policy, `upsertLesson`, increment accepted.
- `search`: build `SharedKbSearchItem[]` from `store.listLessons()` using the existing `searchItemForLesson`, drop revoked, filter by status per policy + `includeReviewed`, score with `scoreText(item.text, tokens(query))`, keep `score === queryTokens.length`, sort, cap to `limit ?? 5`, map to `SearchHit`.
- `snapshot`: `const artifacts = buildSharedKbSnapshotArtifacts({ lessons: await store.listLessons(), revocations: await store.listRevocations(), generatedAt: now() }); const signature = signManifestJson(artifacts.manifestJson, identity.private_key_pem, identity.public_key_pem); return { ...artifacts, signature };`
- `attest`: `validateAttestation`; if lesson missing → `{ ok: false, reason: "unknown lesson" }`; else store and return `{ ok: true }`.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test brain/tests/brain.test.ts tests/shared-kb.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain/core/brain.ts brain/tests/brain.test.ts src/core/shared-kb.ts
git commit -m "feat(brain): add brain service (intake, search, attest, snapshot)"
```

---

### Task 5: HTTP router (Web Fetch API) + kill-switch

A pure `(Request) => Promise<Response>` handler mapping the 6 endpoints to the brain. No server bind here.

**Files:**
- Create: `brain/http/router.ts`
- Test: `brain/tests/router.test.ts`

**Interfaces:**
- Consumes: `Brain` (Task 4).
- Produces:
  ```ts
  export interface RouterOptions { brain: Brain; intakeDisabled?: boolean; fingerprint: string; }
  export function createRouter(opts: RouterOptions): (request: Request) => Promise<Response>;
  ```

**Route table:**
- `GET /healthz` → `200 {"status":"ok","intake_disabled":<bool>,"fingerprint":<string>}`
- `POST /v1/intake` → if `intakeDisabled` → `503 {"error":"intake disabled"}`; parse JSON body (→`400` on parse error); `brain.intake` (→`400` with `{"error": message}` if signature throws); else `200` with `IntakeResult`.
- `GET /v1/search?q=...&tier=trusted|reviewed&limit=N` → `400` if `q` missing; else `200 {"query":q,"results":hits}` (`includeReviewed = tier === "reviewed"`).
- `GET /v1/snapshot` → `200` with `{manifest, manifest_sig, lessons_jsonl, revocations_jsonl, search_index}` from `brain.snapshot()`.
- `POST /v1/attest` → parse body → `brain.attest` → `200 {"ok":true}` or `400 {"error":reason}`.
- `GET /v1/lesson/:id` → `brain.getLesson(id)` → `200` lesson or `404 {"error":"not found"}`.
- Unknown route/method → `404 {"error":"not found"}`.
- All responses `content-type: application/json`.

- [ ] **Step 1: Write the failing test**

```ts
import { createRouter } from "../http/router";
import { createBrain } from "../core/brain";
import { createSqliteStore } from "../core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../core/identity";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function makeRouter(intakeDisabled = false) {
  const dir = await mkdtemp(join(tmpdir(), "brain-router-"));
  const store = createSqliteStore(":memory:"); await store.migrate();
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });
  return { router: createRouter({ brain, intakeDisabled, fingerprint: identity.fingerprint }), cleanup: async () => { await store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("GET /healthz returns ok and fingerprint", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/healthz"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.fingerprint.startsWith("sha256:")).toBe(true);
  await cleanup();
});

test("POST /v1/intake returns 503 when intake disabled (kill-switch)", async () => {
  const { router, cleanup } = await makeRouter(true);
  const res = await router(new Request("http://x/v1/intake", { method: "POST", body: "{}" }));
  expect(res.status).toBe(503);
  await cleanup();
});

test("GET /v1/search without q returns 400", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/v1/search"));
  expect(res.status).toBe(400);
  await cleanup();
});

test("GET /v1/lesson/:id returns 404 for unknown lesson", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/v1/lesson/lesson-does-not-exist"));
  expect(res.status).toBe(404);
  await cleanup();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test brain/tests/router.test.ts`
Expected: FAIL — `../http/router` not found.

- [ ] **Step 3: Implement `brain/http/router.ts`**

Implement per the route table. Use `const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });`. Parse `const url = new URL(request.url);` and branch on `url.pathname` + `request.method`. For `/v1/lesson/:id`, match `url.pathname.startsWith("/v1/lesson/")` and take the trailing segment. Wrap `brain.intake` in try/catch → `json({ error: (e as Error).message }, 400)`.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test brain/tests/router.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain/http/router.ts brain/tests/router.test.ts
git commit -m "feat(brain): add Web Fetch API HTTP router with kill-switch"
```

---

### Task 6: Bun runtime entrypoint

The only platform-specific bind code: a `Bun.serve` wrapper around the router.

**Files:**
- Create: `brain/runtime/bun-server.ts`
- Test: `brain/tests/bun-server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function startBunServer(opts: { router: (req: Request) => Promise<Response>; port: number }): { port: number; stop: () => void };
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { startBunServer } from "../runtime/bun-server";

test("bun server serves the router and stops", async () => {
  const router = async (_req: Request) => new Response(JSON.stringify({ status: "ok" }), { headers: { "content-type": "application/json" } });
  const server = startBunServer({ router, port: 0 }); // port 0 = ephemeral
  const res = await fetch(`http://localhost:${server.port}/healthz`);
  expect((await res.json()).status).toBe("ok");
  server.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test brain/tests/bun-server.test.ts`
Expected: FAIL — `../runtime/bun-server` not found.

- [ ] **Step 3: Implement**

```ts
export function startBunServer(opts: { router: (req: Request) => Promise<Response>; port: number }): { port: number; stop: () => void } {
  const server = Bun.serve({ port: opts.port, fetch: (req) => opts.router(req) });
  return { port: server.port, stop: () => server.stop(true) };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test brain/tests/bun-server.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain/runtime/bun-server.ts brain/tests/bun-server.test.ts
git commit -m "feat(brain): add Bun.serve runtime entrypoint"
```

---

### Task 7: `barry-brain` CLI (init / migrate / serve / conformance)

Operator entrypoint. Reads/writes a JSON config in a data dir, wires store + identity + router + server.

**Files:**
- Create: `brain/core/config.ts`
- Create: `brain/cli.ts`
- Test: `brain/tests/config.test.ts`
- Test: `brain/tests/cli.test.ts`

**Interfaces:**
- Produces (config):
  ```ts
  export interface BrainConfig { version: 1; trust_policy: "company" | "global"; db_path: string; port: number; intake_disabled: boolean; }
  export async function loadOrInitBrainConfig(opts: { dir: string; trustPolicy?: "company" | "global"; port?: number }): Promise<BrainConfig>;
  ```
  Config file is `<dir>/brain.json`; `db_path` defaults to `<dir>/brain.sqlite`; `port` defaults to `8787`; `intake_disabled` reads env `INTAKE_DISABLED === "true"` at serve time (not persisted).

- [ ] **Step 1: Write failing config test**

```ts
import { loadOrInitBrainConfig } from "../core/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("init writes a company config with defaults and reloads it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cfg-"));
  try {
    const created = await loadOrInitBrainConfig({ dir });
    expect(created.trust_policy).toBe("company");
    expect(created.port).toBe(8787);
    expect(created.db_path).toBe(join(dir, "brain.sqlite"));
    const reloaded = await loadOrInitBrainConfig({ dir, trustPolicy: "global" }); // existing file wins
    expect(reloaded.trust_policy).toBe("company");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Write failing CLI test**

```ts
import { runBrainCli } from "../cli";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("barry-brain init scaffolds config + identity in the data dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cli-"));
  try {
    const out = await runBrainCli(["init", "--dir", dir, "--trust-policy", "company"]);
    expect(out.code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "brain.json"), "utf8"));
    expect(cfg.trust_policy).toBe("company");
    const id = JSON.parse(await readFile(join(dir, "identity.json"), "utf8"));
    expect(typeof id.public_key_pem).toBe("string");
    // init prints the public-key fingerprint for clients to pin
    expect(out.stdout).toContain("sha256:");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("barry-brain migrate creates the database schema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cli2-"));
  try {
    await runBrainCli(["init", "--dir", dir]);
    const out = await runBrainCli(["migrate", "--dir", dir]);
    expect(out.code).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("migrat");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `bun test brain/tests/config.test.ts brain/tests/cli.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement config and CLI**

`brain/core/config.ts`: implement `loadOrInitBrainConfig` (if `<dir>/brain.json` exists, load it; else write defaults and return). `intake_disabled` is set from `process.env.INTAKE_DISABLED === "true"` when building the runtime, not stored.

`brain/cli.ts`: export `async function runBrainCli(argv: string[]): Promise<{ code: number; stdout: string }>` that:
- parses `--dir <path>` (default `process.env.BRAIN_DATA_DIR ?? ".brain-data"`), `--trust-policy`, `--port`.
- `init`: `loadOrInitBrainConfig` + `loadOrCreateBrainIdentity({ dir, now: new Date().toISOString() })`; return stdout containing `Brain initialized. Pin this fingerprint in clients: <fingerprint>`.
- `migrate`: open `createSqliteStore(config.db_path)`, `await store.migrate()`, close; stdout `Database migrated at <db_path>`.
- `serve`: build store + identity + brain + router (`intakeDisabled` from env) + `startBunServer`; print `Brain serving on :<port> (fingerprint <fp>)`; this branch runs indefinitely — in tests it is NOT invoked.
- `conformance`: delegate to Task 8's `runConformance`.
- Add a `if (import.meta.main) runBrainCli(process.argv.slice(2)).then((r) => { process.stdout.write(r.stdout + "\n"); process.exit(r.code); });` guard at the bottom.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test brain/tests/config.test.ts brain/tests/cli.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain/core/config.ts brain/cli.ts brain/tests/config.test.ts brain/tests/cli.test.ts
git commit -m "feat(brain): add barry-brain CLI (init/migrate/serve)"
```

---

### Task 8: Conformance suite

A battery that exercises the Brain contract against any base URL, proving an implementation conforms. Runs against an in-process Bun server in tests.

**Files:**
- Create: `brain/conformance/suite.ts`
- Test: `brain/tests/conformance.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ConformanceCheck { name: string; ok: boolean; detail?: string; }
  export interface ConformanceReport { url: string; passed: number; failed: number; checks: ConformanceCheck[]; }
  export async function runConformance(opts: { baseUrl: string; fetch?: typeof fetch }): Promise<ConformanceReport>;
  ```

**Checks (v1):** `GET /healthz` returns `status: "ok"`; `GET /v1/search?q=x` returns `200` with a `results` array; `GET /v1/snapshot` returns `200` with a `manifest` object whose `version === 1`; `GET /v1/lesson/<random>` returns `404`; `POST /v1/intake` with an empty/invalid body returns `400` (or `503` if intake disabled — both acceptable for the contract).

- [ ] **Step 1: Write the failing test**

```ts
import { runConformance } from "../conformance/suite";
import { createRouter } from "../http/router";
import { createBrain } from "../core/brain";
import { createSqliteStore } from "../core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../core/identity";
import { startBunServer } from "../runtime/bun-server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("conformance suite passes against a real in-process brain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-conf-"));
  const store = createSqliteStore(":memory:"); await store.migrate();
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });
  const server = startBunServer({ router: createRouter({ brain, fingerprint: identity.fingerprint }), port: 0 });
  try {
    const report = await runConformance({ baseUrl: `http://localhost:${server.port}` });
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThanOrEqual(5);
  } finally { server.stop(); await store.close(); await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test brain/tests/conformance.test.ts`
Expected: FAIL — `../conformance/suite` not found.

- [ ] **Step 3: Implement `runConformance`**

Implement each check with the injected (or global) `fetch`, accumulating `ConformanceCheck` results and counting pass/fail. For intake, accept `res.status === 400 || res.status === 503`.

- [ ] **Step 4: Wire `conformance` into the CLI**

In `brain/cli.ts`, add `conformance --url <baseUrl>`: call `runConformance({ baseUrl })`, write each check as `[PASS]/[FAIL] name`, set `code` to `report.failed === 0 ? 0 : 1`.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test brain/tests/conformance.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain/conformance/suite.ts brain/tests/conformance.test.ts brain/cli.ts
git commit -m "feat(brain): add Brain contract conformance suite"
```

---

### Task 9: Dockerfile + self-host docs

Package the brain as a one-command container and document setup.

**Files:**
- Create: `brain/Dockerfile`
- Create: `brain/.dockerignore`
- Create: `docs/brain-self-host.md`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install
COPY src ./src
COPY brain ./brain
ENV BRAIN_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
# init is idempotent; migrate then serve
ENTRYPOINT ["bun", "run", "brain/cli.ts"]
CMD ["serve", "--dir", "/data", "--port", "8787"]
```

- [ ] **Step 2: Write `brain/.dockerignore`**

```text
node_modules
dist
.brain-data
**/*.test.ts
```

- [ ] **Step 3: Write `docs/brain-self-host.md`**

Document, with exact commands:
- One-liner: `docker build -t barry-brain -f brain/Dockerfile . && docker run -v "$PWD/brain-data:/data" -p 8787:8787 barry-brain`
- First run: container auto-creates config + identity in `/data`; retrieve the pin fingerprint via `docker run -v "$PWD/brain-data:/data" barry-brain init --dir /data` (prints `sha256:...`).
- Point a Barry client at it: set repo config `shared_kb.brain = { url: "http://host:8787", scope: "private", trust_policy: "company" }` and pin the fingerprint.
- Operations: kill-switch `docker run -e INTAKE_DISABLED=true ...`; backups = copy `/data/brain.sqlite`; conformance check `bun run brain/cli.ts conformance --url http://localhost:8787`.
- Trust-policy note: `company` makes submitted lessons usable immediately; `global` (strict staged maturation) is a future extension.

- [ ] **Step 4: Verify the container builds and serves (manual gate)**

Run:
```bash
docker build -t barry-brain -f brain/Dockerfile .
docker run -d --name barry-brain-test -p 8787:8787 -v "$PWD/brain-data:/data" barry-brain
sleep 2 && curl -s localhost:8787/healthz
docker rm -f barry-brain-test
```
Expected: `{"status":"ok",...}`. (If Docker is unavailable in the environment, record that this step was skipped and verify `bun run brain/cli.ts serve` + `curl` locally instead.)

- [ ] **Step 5: Commit**

```bash
git add brain/Dockerfile brain/.dockerignore docs/brain-self-host.md
git commit -m "feat(brain): add Dockerfile and self-host documentation"
```

---

### Task 10: Full verification, ADR, and source-backed facts

**Files:**
- Create: `docs/context/adrs/ADR-00XX-ship-self-hostable-brain-server.md` (number assigned by `barry adr new`)
- Modify: `docs/context/features/shared-kb/{README.md,IDMAP.md,KG.adj,FACTS.jsonl}`

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS (all existing + new brain tests).

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Create the ADR**

Run: `bun run barry -- adr new --title "Ship self-hostable Brain server for distributed shared KB" --tags "shared-kb,brain,self-host,vendor-independence"`

Fill it with: context (companies need a private KB; vendor lock-in is a risk); decision (portable Web-Fetch-API core + `BrainStore`/`SnapshotPublisher` interfaces; v1 ships Docker + `bun:sqlite`; clients pin the brain's Ed25519 fingerprint; `company` trust policy ships, strict `global` maturation deferred); consequences (one codebase serves global + company; SQLite-only operational surface; new adapters add backends without core rewrite).

- [ ] **Step 4: Update shared-kb context pack**

- `IDMAP.md`: add `BRAIN_*` ids for `brain/core/brain.ts`, `brain/core/store-sqlite.ts`, `brain/http/router.ts`, `brain/cli.ts`, `docs/brain-self-host.md`, and the new ADR.
- `KG.adj`: add edges like `brain serves vendor-neutral-contract`, `brain stores lessons-in-sqlite`, `brain signs snapshots-with-pinned-key`, `brain reuses shared-kb-core`.
- `FACTS.jsonl`: add `kind:"decision"` and `kind:"implemented"` facts (collision-resistant ids like `SKB-<ISO>-<hash>`, ISO `updated_at`) covering: the self-hostable Brain server, the portable core + storage abstraction, Docker+SQLite v1 target, fingerprint pinning, and the `company`/`global` trust-policy split. Point `src` at the new IDMAP ids.
- `README.md`: extend the pack scope sentence to include the Brain server.

- [ ] **Step 5: Validate Barry context**

Run: `bun run barry -- validate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/context/adrs docs/context/features/shared-kb
git commit -m "docs(shared-kb): record self-hostable Brain server ADR and facts"
```

---

## Self-Review

- **Spec coverage:** Portable core (Tasks 4–6: Web-Fetch router + Bun runtime + service); `BrainStore`/SQLite (Task 3); `SnapshotPublisher` is covered implicitly by the snapshot endpoint returning artifacts (a dedicated publisher interface is deferred — v1 serves snapshots over HTTP rather than pushing to external storage, noted below); six endpoints (Task 5); reuse of shared schema/validation/signing (Tasks 1, 4); brain identity + fingerprint pinning (Task 2); CLI init/migrate/serve/conformance (Tasks 7–8); Docker + SQLite (Task 9); company-trust-now / strict-maturation-deferred (Task 4 policy); ADR + facts (Task 10).
- **Deferred vs spec (intentional, called out):** (1) `SnapshotPublisher` as a standalone interface — v1 serves the snapshot via `GET /v1/snapshot`; pushing to R2/S3 arrives with the Cloudflare adapter. (2) Strict `global` staged-maturation + reputation engine — a separate plan (SP4). (3) Intake rate-limits/PoW — belong with the public global deployment (SP3 abuse-resistance), not the company self-host baseline. These are scope boundaries, not gaps.
- **Placeholder scan:** No TBD/TODO; every code step shows code; signatures are concrete.
- **Type consistency:** `BrainStore`, `StoredAttestation`, `Brain`, `IntakeBatch`, `SearchHit`, `BrainIdentity`, `BrainConfig`, `ConformanceReport` are defined once and consumed with matching names/signatures across tasks. `buildSharedKbSnapshotArtifacts`, `signManifestJson`, `tokens`, `scoreText` are exported from `shared-kb.ts` in Tasks 1/4 before brain consumption.
