export const sharedKbKinds = ["lesson", "anti_pattern", "decision_pattern"] as const;
export const sharedKbStatuses = ["submitted", "quarantined", "reviewed", "trusted", "rejected", "challenged", "deprecated", "revoked", "superseded"] as const;

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

// Barry's canonical search-item shape, reused by the cq consume adapter.
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

// Token scoring shared with the cq consume adapter.
export function tokens(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

export function scoreText(text: string, queryTokens: string[]): number {
  return queryTokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
