import { expect, test } from "bun:test";
import { computeReputation } from "../src/core/shared-kb-reputation";
import type { SharedKbAttestation } from "../src/core/shared-kb-attestation";

function att(over: Partial<SharedKbAttestation> = {}): SharedKbAttestation {
  return {
    id: "a1",
    lesson_id: "L1",
    validator_id: "V1",
    result: "confirmed",
    confidence: 0.8,
    context_tags: ["cli"],
    evidence_type: "observed_success",
    upstream_seen: [],
    created_at: "2026-06-18T00:00:00.000Z",
    public_key: "",
    signature: "",
    ...over,
  };
}

test("confirmations raise a lesson score and count independent sources", () => {
  const r = computeReputation({ attestations: [att({ id: "a1", validator_id: "V1" }), att({ id: "a2", validator_id: "V2" })] });
  expect(r.lessons.L1!.score).toBeGreaterThan(0.5);
  expect(r.lessons.L1!.positive).toBe(2);
  expect(r.lessons.L1!.independent_sources).toBe(2);
});

test("a strong observed_failure contradiction can outweigh a confirmation", () => {
  const r = computeReputation({ attestations: [att({ id: "a1", validator_id: "V1" }), att({ id: "a2", validator_id: "V2", result: "contradicted", evidence_type: "observed_failure", confidence: 0.95 })] });
  expect(r.lessons.L1!.score).toBeLessThan(0.5);
  expect(r.lessons.L1!.negative).toBe(1);
});

test("copied evidence is discounted relative to independent evidence", () => {
  const independent = computeReputation({ attestations: [att({ id: "a1", validator_id: "V1" })] }).lessons.L1!.score;
  const copied = computeReputation({ attestations: [att({ id: "a1", validator_id: "V1", upstream_seen: ["L1"] })] }).lessons.L1!.score;
  expect(copied).toBeLessThan(independent);
});

test("validator reputation reflects agreement with the resulting lesson score", () => {
  const r = computeReputation({
    attestations: [
      att({ id: "a1", validator_id: "V1" }),
      att({ id: "a2", validator_id: "V2" }),
      att({ id: "a3", validator_id: "V3", result: "contradicted", evidence_type: "observed_failure", confidence: 0.5 }),
    ],
  });
  expect(r.lessons.L1!.score).toBeGreaterThan(0.5);
  expect(r.validators.V1!.reputation).toBe(1);
  expect(r.validators.V3!.reputation).toBe(0);
});

test("static_review weighs less than observed outcomes", () => {
  const observed = computeReputation({ attestations: [att({ evidence_type: "observed_success" })] }).lessons.L1!.score;
  const review = computeReputation({ attestations: [att({ evidence_type: "static_review" })] }).lessons.L1!.score;
  expect(review).toBeLessThan(observed);
});
