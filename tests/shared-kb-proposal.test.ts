import { expect, test } from "bun:test";
import { buildLessonProposal, listOutboxLessons, writeProposalToOutbox } from "../src/core/shared-kb-proposal";
import { withTempRepo } from "./helpers";

const input = {
  title: "Treat handoffs as claims until validated",
  problem: "Agents may trust stale handoff summaries.",
  applies_when: ["multi-agent coding workflow"],
  recommendation: "Validate claims before treating them as durable context.",
  why: "This prevents stale operational memory from becoming canonical truth.",
  avoid_when: ["the source cannot be safely anonymized"],
  tags: ["agents", "validation"],
  confidence: "medium" as const,
};

test("buildLessonProposal returns a valid submitted lesson with defaults and a dated id", () => {
  const lesson = buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z" });
  expect(lesson.id).toMatch(/^lesson-20260618-[0-9a-f]{8}$/);
  expect(lesson.kind).toBe("lesson");
  expect(lesson.status).toBe("submitted");
  expect(lesson.evidence).toEqual({ source_type: "community_report", count: 1 });
  expect(lesson.updated_at).toBe("2026-06-18T10:00:00.000Z");
});

test("buildLessonProposal can carry a non-default kind (decision_pattern / anti_pattern)", () => {
  const decision = buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z", kind: "decision_pattern" });
  expect(decision.kind).toBe("decision_pattern");
  const anti = buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z", kind: "anti_pattern" });
  expect(anti.kind).toBe("anti_pattern");
  expect(buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z" }).kind).toBe("lesson");
});

test("buildLessonProposal is deterministic for identical input", () => {
  const a = buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z" });
  const b = buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z" });
  expect(b.id).toBe(a.id);
});

test("buildLessonProposal rejects a proposal that leaks a private file path", () => {
  expect(() => buildLessonProposal({ ...input, recommendation: "Edit src/core/secret.ts to fix it." }, { now: "2026-06-18T10:00:00.000Z" })).toThrow(/revealing file path/i);
});

test("outbox round-trip: write a proposal then list it", async () => {
  await withTempRepo(async (repo) => {
    const lesson = buildLessonProposal(input, { now: "2026-06-18T10:00:00.000Z" });
    await writeProposalToOutbox({ repo, lesson });
    const listed = await listOutboxLessons({ repo });
    expect(listed.map((l) => l.id)).toEqual([lesson.id]);
  });
});

test("listOutboxLessons returns empty when no outbox exists", async () => {
  await withTempRepo(async (repo) => {
    expect(await listOutboxLessons({ repo })).toEqual([]);
  });
});
