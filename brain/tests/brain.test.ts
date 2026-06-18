import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrain, type IntakeItem } from "../core/brain";
import { createSqliteStore } from "../core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../core/identity";
import { signIntakeBatch } from "../../src/core/shared-kb-intake";

function signedBatch(items: IntakeItem[]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return signIntakeBatch({ version: 1, validator_id: "validator-test", public_key: Buffer.from(pub).toString("base64"), items }, priv);
}

const lesson = {
  id: "lesson-20260601-aaaa1111",
  kind: "lesson",
  status: "submitted",
  title: "T",
  problem: "P",
  applies_when: ["x"],
  recommendation: "R",
  why: "W",
  avoid_when: ["y"],
  confidence: "high",
  evidence: { source_type: "community_report", count: 1 },
  tags: ["cli"],
  updated_at: "2026-06-01T00:00:00.000Z",
};

async function makeBrain(trustPolicy: "company" | "global" = "company") {
  const dir = await mkdtemp(join(tmpdir(), "brain-svc-"));
  const store = createSqliteStore(":memory:");
  await store.migrate();
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy, now: () => "2026-06-18T00:00:00.000Z" });
  return { brain, store, cleanup: async () => { await store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("company brain accepts a valid signed lesson batch and makes it searchable as trusted", async () => {
  const { brain, cleanup } = await makeBrain("company");
  const result = await brain.intake(signedBatch([{ type: "lesson", record: lesson }]));
  expect(result.accepted).toBe(1);
  expect(result.rejected.length).toBe(0);

  expect((await brain.search("nonexistentword")).length).toBe(0); // token not present
  const hits = await brain.search("cli"); // matches the lesson tag
  expect(hits[0]?.id).toBe(lesson.id);
  expect(hits[0]?.status).toBe("trusted");

  const snap = await brain.snapshot();
  expect(snap.manifest.counts.lessons).toBe(1);
  const expected = `sha256:${createHash("sha256").update(Buffer.from(snap.manifestJson)).digest("hex")}`;
  expect(snap.signature.signed_payload_sha256).toBe(expected);
  await cleanup();
});

test("global brain stores accepted lessons as reviewed (not trusted by default)", async () => {
  const { brain, cleanup } = await makeBrain("global");
  await brain.intake(signedBatch([{ type: "lesson", record: lesson }]));
  expect((await brain.search("cli")).length).toBe(0); // reviewed hidden by default
  const reviewed = await brain.search("cli", { includeReviewed: true });
  expect(reviewed[0]?.status).toBe("reviewed");
  await cleanup();
});

test("intake rejects a lesson containing a leaked file path, keeps valid siblings", async () => {
  const { brain, cleanup } = await makeBrain("company");
  const leaky = { ...lesson, id: "lesson-20260601-bbbb2222", problem: "fails in src/core/secret.ts loader" };
  const result = await brain.intake(signedBatch([{ type: "lesson", record: lesson }, { type: "lesson", record: leaky }]));
  expect(result.accepted).toBe(1);
  expect(result.rejected[0]?.index).toBe(1);
  await cleanup();
});

test("intake rejects a batch whose signature does not verify", async () => {
  const { brain, cleanup } = await makeBrain("company");
  const batch = signedBatch([{ type: "lesson", record: lesson }]);
  batch.signature = Buffer.from("not-a-real-signature").toString("base64");
  await expect(brain.intake(batch)).rejects.toThrow(/signature/i);
  await cleanup();
});

test("attest stores an attestation for an existing lesson and rejects unknown lessons", async () => {
  const { brain, cleanup } = await makeBrain("company");
  await brain.intake(signedBatch([{ type: "lesson", record: lesson }]));
  const ok = await brain.attest({ id: "att-1", lesson_id: lesson.id, validator_id: "v", result: "confirmed", confidence: 0.8, context_tags: ["cli"], evidence_type: "observed_success", upstream_seen: [], created_at: "2026-06-18T00:00:00.000Z", public_key: "pk", signature: "sig" });
  expect(ok.ok).toBe(true);
  const bad = await brain.attest({ id: "att-2", lesson_id: "lesson-nope", validator_id: "v", result: "confirmed", confidence: 0.8, context_tags: [], evidence_type: "static_review", upstream_seen: [], created_at: "2026-06-18T00:00:00.000Z", public_key: "pk", signature: "sig" });
  expect(bad.ok).toBe(false);
  await cleanup();
});

test("getLesson returns the lesson and its attestation count", async () => {
  const { brain, cleanup } = await makeBrain("company");
  await brain.intake(signedBatch([{ type: "lesson", record: lesson }]));
  await brain.attest({ id: "att-1", lesson_id: lesson.id, validator_id: "v", result: "confirmed", confidence: 0.8, context_tags: [], evidence_type: "observed_success", upstream_seen: [], created_at: "2026-06-18T00:00:00.000Z", public_key: "pk", signature: "sig" });
  const found = await brain.getLesson(lesson.id);
  expect(found?.attestations).toBe(1);
  expect(found?.lesson.id).toBe(lesson.id);
  expect(await brain.getLesson("missing")).toBeNull();
  await cleanup();
});
