import { expect, test } from "bun:test";
import { createSqliteStore } from "../core/store-sqlite";
import type { SharedKbLesson } from "../../src/core/shared-kb";

const lesson = {
  id: "lesson-20260601-aaaa1111",
  kind: "lesson",
  status: "trusted",
  title: "T",
  problem: "P",
  applies_when: ["x"],
  recommendation: "R",
  why: "W",
  avoid_when: ["y"],
  confidence: "high",
  evidence: { source_type: "community_report", count: 1 },
  tags: ["agents"],
  updated_at: "2026-06-01T00:00:00.000Z",
} as unknown as SharedKbLesson;

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

test("getLesson returns null for an unknown id", async () => {
  const store = createSqliteStore(":memory:");
  await store.migrate();
  expect(await store.getLesson("lesson-nope")).toBeNull();
  await store.close();
});
