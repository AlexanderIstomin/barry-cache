import { expect, test } from "bun:test";
import { decideLessonStatus, defaultGlobalThresholds, type MaturationThresholds } from "../core/maturation";
import type { SharedKbAttestation } from "../../src/core/shared-kb-attestation";
import type { SharedKbLesson } from "../../src/core/shared-kb";
import type { LessonScore } from "../../src/core/shared-kb-reputation";

const lesson = { id: "L1", status: "reviewed", updated_at: "2026-06-01T00:00:00.000Z" } as unknown as SharedKbLesson;

function confirm(validator: string, tags: string[]): SharedKbAttestation {
  return { id: `a-${validator}`, lesson_id: "L1", validator_id: validator, result: "confirmed", confidence: 0.8, context_tags: tags, evidence_type: "observed_success", upstream_seen: [], created_at: "2026-06-10T00:00:00.000Z", public_key: "", signature: "" };
}

function score(value: number): LessonScore {
  return { score: value, raw: 0, positive: 0, negative: 0, not_applicable: 0, independent_sources: 0 };
}

const T: MaturationThresholds = { ...defaultGlobalThresholds, minObservationMs: 0 };

test("promotes reviewed -> trusted with enough independent confirmations across diverse contexts", () => {
  const atts = [confirm("V1", ["cli"]), confirm("V2", ["typescript"]), confirm("V3", ["api"])];
  const d = decideLessonStatus({ lesson, receivedAt: "2026-06-01T00:00:00.000Z", attestations: atts, score: score(0.8), now: "2026-06-12T00:00:00.000Z", thresholds: T });
  expect(d.status).toBe("trusted");
});

test("stays reviewed when independent confirmations are below threshold", () => {
  const atts = [confirm("V1", ["cli"]), confirm("V2", ["typescript"])];
  const d = decideLessonStatus({ lesson, receivedAt: "2026-06-01T00:00:00.000Z", attestations: atts, score: score(0.8), now: "2026-06-12T00:00:00.000Z", thresholds: T });
  expect(d.status).toBe("reviewed");
});

test("stays reviewed when confirmations lack context diversity", () => {
  const atts = [confirm("V1", ["cli"]), confirm("V2", ["cli"]), confirm("V3", ["cli"])];
  const d = decideLessonStatus({ lesson, receivedAt: "2026-06-01T00:00:00.000Z", attestations: atts, score: score(0.8), now: "2026-06-12T00:00:00.000Z", thresholds: T });
  expect(d.status).toBe("reviewed");
});

test("respects the observation window (too-recent lesson is not promoted)", () => {
  const atts = [confirm("V1", ["cli"]), confirm("V2", ["typescript"]), confirm("V3", ["api"])];
  const windowed: MaturationThresholds = { ...defaultGlobalThresholds, minObservationMs: 7 * 24 * 60 * 60 * 1000 };
  const d = decideLessonStatus({ lesson, receivedAt: "2026-06-12T00:00:00.000Z", attestations: atts, score: score(0.9), now: "2026-06-12T01:00:00.000Z", thresholds: windowed });
  expect(d.status).toBe("reviewed");
});

test("demotes to challenged on a credible observed_failure contradiction with a net-negative score", () => {
  const trusted = { ...lesson, status: "trusted" } as unknown as SharedKbLesson;
  const atts: SharedKbAttestation[] = [
    confirm("V1", ["cli"]),
    { id: "x", lesson_id: "L1", validator_id: "V9", result: "contradicted", confidence: 0.95, context_tags: ["cli"], evidence_type: "observed_failure", upstream_seen: [], created_at: "2026-06-11T00:00:00.000Z", public_key: "", signature: "" },
  ];
  const d = decideLessonStatus({ lesson: trusted, receivedAt: "2026-06-01T00:00:00.000Z", attestations: atts, score: score(0.3), now: "2026-06-12T00:00:00.000Z", thresholds: T });
  expect(d.status).toBe("challenged");
});

test("leaves terminal statuses (revoked) unchanged", () => {
  const revoked = { ...lesson, status: "revoked" } as unknown as SharedKbLesson;
  const d = decideLessonStatus({ lesson: revoked, receivedAt: "2026-06-01T00:00:00.000Z", attestations: [], score: score(0.9), now: "2026-06-12T00:00:00.000Z", thresholds: T });
  expect(d.status).toBe("revoked");
});
