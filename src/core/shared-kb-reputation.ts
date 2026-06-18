import type { SharedKbAttestation } from "./shared-kb-attestation";

export interface LessonScore {
  score: number; // sigmoid, 0..1
  raw: number; // pre-sigmoid weighted sum
  positive: number;
  negative: number;
  not_applicable: number;
  independent_sources: number;
}

export interface ValidatorReputation {
  reputation: number; // 0..1
  attestations: number;
}

export interface ReputationReport {
  lessons: Record<string, LessonScore>;
  validators: Record<string, ValidatorReputation>;
}

const EVIDENCE_WEIGHTS: Record<SharedKbAttestation["evidence_type"], number> = {
  observed_success: 1.0,
  observed_failure: 1.2,
  static_review: 0.35,
};

function direction(result: SharedKbAttestation["result"]): number {
  return result === "confirmed" ? 1 : result === "contradicted" ? -1 : 0;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function contribution(att: SharedKbAttestation): number {
  const copied = att.upstream_seen.includes(att.lesson_id) ? 0.25 : 1;
  const confidenceWeight = 0.5 + att.confidence;
  return direction(att.result) * EVIDENCE_WEIGHTS[att.evidence_type] * copied * confidenceWeight;
}

/**
 * Single-pass, outcome-grounded scoring. Lesson scores aggregate signed,
 * evidence-weighted, copied-discounted attestation contributions; validator
 * reputation is agreement with the resulting lesson scores (no recursive
 * EigenTrust iteration in v1).
 */
export function computeReputation(input: { attestations: SharedKbAttestation[] }): ReputationReport {
  const lessons: Record<string, LessonScore> = {};
  const independent: Record<string, Set<string>> = {};

  for (const att of input.attestations) {
    const score = (lessons[att.lesson_id] ??= { score: 0, raw: 0, positive: 0, negative: 0, not_applicable: 0, independent_sources: 0 });
    score.raw += contribution(att);
    if (att.result === "confirmed") score.positive += 1;
    else if (att.result === "contradicted") score.negative += 1;
    else score.not_applicable += 1;
    if (direction(att.result) !== 0) {
      (independent[att.lesson_id] ??= new Set()).add(att.validator_id);
    }
  }
  for (const [id, score] of Object.entries(lessons)) {
    score.score = sigmoid(score.raw);
    score.independent_sources = independent[id]?.size ?? 0;
  }

  const agreements: Record<string, { agree: number; directional: number; total: number }> = {};
  for (const att of input.attestations) {
    const stats = (agreements[att.validator_id] ??= { agree: 0, directional: 0, total: 0 });
    stats.total += 1;
    const dir = direction(att.result);
    if (dir === 0) continue;
    stats.directional += 1;
    const score = lessons[att.lesson_id]!.score;
    if ((dir > 0 && score > 0.5) || (dir < 0 && score < 0.5)) stats.agree += 1;
  }
  const validators: Record<string, ValidatorReputation> = {};
  for (const [id, stats] of Object.entries(agreements)) {
    validators[id] = {
      reputation: stats.directional > 0 ? stats.agree / stats.directional : 0.5,
      attestations: stats.total,
    };
  }

  return { lessons, validators };
}
