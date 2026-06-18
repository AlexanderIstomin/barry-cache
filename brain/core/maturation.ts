import type { SharedKbLesson, SharedKbStatus } from "../../src/core/shared-kb";
import type { SharedKbAttestation } from "../../src/core/shared-kb-attestation";
import type { LessonScore } from "../../src/core/shared-kb-reputation";

export interface MaturationThresholds {
  minIndependentConfirmations: number;
  minContextDiversity: number;
  minScore: number;
  minObservationMs: number;
  contradictionConfidence: number;
}

export const defaultGlobalThresholds: MaturationThresholds = {
  minIndependentConfirmations: 3,
  minContextDiversity: 2,
  minScore: 0.6,
  minObservationMs: 0,
  contradictionConfidence: 0.7,
};

export interface MaturationDecision {
  status: SharedKbStatus;
  reasons: string[];
}

const TERMINAL: SharedKbStatus[] = ["revoked", "deprecated", "superseded"];

/**
 * Decide a lesson's status under the strict (global) policy from its
 * outcome-grounded attestations and aggregate score. Self-correcting: a
 * credible observed_failure that drives the score net-negative demotes the
 * lesson to `challenged`; promotion to `trusted` requires enough independent
 * confirmations across diverse contexts, a positive score, and a minimum
 * observation window. Terminal statuses are never auto-changed.
 */
export function decideLessonStatus(input: {
  lesson: SharedKbLesson;
  receivedAt: string;
  attestations: SharedKbAttestation[];
  score: LessonScore;
  now: string;
  thresholds: MaturationThresholds;
}): MaturationDecision {
  const { lesson, attestations, score, thresholds } = input;
  if (TERMINAL.includes(lesson.status)) {
    return { status: lesson.status, reasons: ["terminal status is not auto-changed"] };
  }

  const grounded = attestations.filter((a) => a.result === "confirmed" && a.evidence_type === "observed_success");
  const confirmers = new Set(grounded.map((a) => a.validator_id));
  const contexts = new Set(grounded.flatMap((a) => a.context_tags));
  const credibleContradiction = attestations.some(
    (a) => a.result === "contradicted" && a.evidence_type === "observed_failure" && a.confidence >= thresholds.contradictionConfidence,
  );
  const elapsed = Date.parse(input.now) - Date.parse(input.receivedAt);

  if (credibleContradiction && score.score < thresholds.minScore) {
    return { status: "challenged", reasons: [`credible observed_failure contradiction with net-negative score ${score.score.toFixed(2)}`] };
  }

  const reasons: string[] = [];
  const enoughConfirmers = confirmers.size >= thresholds.minIndependentConfirmations;
  const enoughDiversity = contexts.size >= thresholds.minContextDiversity;
  const enoughScore = score.score >= thresholds.minScore;
  const enoughTime = elapsed >= thresholds.minObservationMs;
  if (!enoughConfirmers) reasons.push(`needs ${thresholds.minIndependentConfirmations} independent confirmations, has ${confirmers.size}`);
  if (!enoughDiversity) reasons.push(`needs ${thresholds.minContextDiversity} distinct context tags, has ${contexts.size}`);
  if (!enoughScore) reasons.push(`needs score >= ${thresholds.minScore}, has ${score.score.toFixed(2)}`);
  if (!enoughTime) reasons.push("observation window not yet elapsed");

  if (enoughConfirmers && enoughDiversity && enoughScore && enoughTime) {
    return { status: "trusted", reasons: [`promoted: ${confirmers.size} independent confirmations across ${contexts.size} contexts, score ${score.score.toFixed(2)}`] };
  }
  return { status: "reviewed", reasons };
}
