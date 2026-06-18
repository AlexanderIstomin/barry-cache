import { readTextIfExists, repoPath } from "./fs";

export interface HarvestSource {
  kind: "success" | "failure";
  summary: string;
  files?: string[] | undefined;
  expected?: string | undefined;
  actual?: string | undefined;
}

export interface HarvestGate {
  harvest: boolean;
  score: number;
  reasons: string[];
}

export interface HarvestDraft {
  title: string;
  problem: string;
  applies_when: string[];
  recommendation: string;
  why: string;
  avoid_when: string[];
  tags: string[];
  confidence: "low" | "medium" | "high";
}

export interface HarvestCandidate {
  source: HarvestSource;
  gate: HarvestGate;
  draft: HarvestDraft;
  checklist: string[];
  proposeCommand: string;
}

const VALUE_TERMS = /\b(fail|failed|failure|bug|debug|regression|validation|security|privacy|auth|schema|migration|architecture|adr|concurrency|race|deadlock|recurring|handoff|incident|root cause)\b/i;
const TRIVIAL_TERMS = /\b(rename|typo|format|formatting|whitespace|lint|label|copy change|comment|wording)\b/i;

const EXTENSION_TAGS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
  sql: "database", md: "docs", json: "config", yml: "config", yaml: "config", sh: "shell",
};

const TOPIC_TAGS = ["auth", "schema", "migration", "validation", "security", "privacy", "performance", "concurrency", "api", "cli", "test", "cache"];

export function harvestGate(source: HarvestSource): HarvestGate {
  const text = `${source.summary} ${source.expected ?? ""} ${source.actual ?? ""}`;
  const reasons: string[] = [];
  let score = 0;
  if (source.kind === "failure") {
    score += 3;
    reasons.push("validated failure is high-value reusable knowledge");
  }
  if (VALUE_TERMS.test(text)) {
    score += 2;
    reasons.push("mentions debugging, validation, security, or architecture");
  }
  if (source.summary.length > 120) {
    score += 1;
    reasons.push("substantial summary suggests non-trivial work");
  }
  if (TRIVIAL_TERMS.test(source.summary)) {
    score -= 2;
    reasons.push("looks cosmetic/trivial and cheap to rediscover");
  }
  const harvest = score >= 2;
  if (!harvest && reasons.length === 0) reasons.push("low expected reuse value");
  return { harvest, score, reasons };
}

function shorten(value: string, max = 100): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function deriveTags(source: HarvestSource): string[] {
  const tags = new Set<string>();
  for (const file of source.files ?? []) {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    if (EXTENSION_TAGS[ext]) tags.add(EXTENSION_TAGS[ext]);
  }
  const text = `${source.summary} ${source.expected ?? ""} ${source.actual ?? ""}`.toLowerCase();
  for (const topic of TOPIC_TAGS) {
    if (text.includes(topic)) tags.add(topic);
  }
  if (tags.size === 0) tags.add("general");
  return [...tags];
}

export function buildHarvestCandidate(source: HarvestSource): HarvestCandidate {
  const gate = harvestGate(source);
  const tags = deriveTags(source);
  const isFailure = source.kind === "failure";
  const draft: HarvestDraft = {
    title: isFailure ? `Avoid: ${shorten(source.summary, 70)}` : `Lesson: ${shorten(source.summary, 70)}`,
    problem: isFailure
      ? `Expected ${shorten(source.expected ?? "the intended behavior", 80)}, but observed ${shorten(source.actual ?? "a different result", 80)}.`
      : shorten(source.summary, 160),
    applies_when: ["similar tasks in this area (generalize before sharing)"],
    recommendation: isFailure
      ? "Describe the guard or fix that prevents this failure class (rewrite generically)."
      : "Describe the reusable approach that worked here (rewrite generically).",
    why: isFailure
      ? "Captured from a validated failure; explain the underlying reason it recurs."
      : "Captured from a completed task; explain why this generalizes beyond one repo.",
    avoid_when: ["the source cannot be safely anonymized"],
    tags,
    confidence: isFailure ? "medium" : "low",
  };
  const checklist = [
    "Anonymize: remove project, product, customer, and team names; describe the pattern generically.",
    "Strip private file paths (no src/…, app/…), secrets, tokens, non-example URLs, and emails.",
    "Generalize the problem and recommendation so they apply beyond this repository.",
    "Make the recommendation and rationale concrete and actionable.",
    "Drop the lesson entirely if it cannot be safely anonymized.",
  ];
  return { source, gate, draft, checklist, proposeCommand: renderProposeCommand(draft) };
}

function renderProposeCommand(draft: HarvestDraft): string {
  const q = (value: string) => `"${value.replaceAll('"', "'")}"`;
  return [
    "barry-cache kb propose lesson",
    `--title ${q(draft.title)}`,
    `--problem ${q(draft.problem)}`,
    `--applies-when ${q(draft.applies_when.join(","))}`,
    `--recommendation ${q(draft.recommendation)}`,
    `--why ${q(draft.why)}`,
    `--avoid-when ${q(draft.avoid_when.join(","))}`,
    `--tags ${q(draft.tags.join(","))}`,
    `--confidence ${draft.confidence}`,
  ].join(" ");
}

export async function readLatestHarvestSources(options: { repo: string }): Promise<HarvestSource[]> {
  const sources: HarvestSource[] = [];

  const handoff = lastRecord(await readTextIfExists(repoPath(options.repo, ".context-state/handoffs/handoffs.jsonl")));
  if (handoff && (handoff.status === "success" || handoff.status === "partial") && typeof handoff.summary === "string") {
    sources.push({ kind: "success", summary: handoff.summary, files: asStringArray(handoff.files) });
  }

  const failure = lastRecord(await readTextIfExists(repoPath(options.repo, ".context-state/failures/failures.jsonl")));
  if (failure && typeof failure.summary === "string") {
    sources.push({
      kind: "failure",
      summary: failure.summary,
      expected: typeof failure.expected === "string" ? failure.expected : undefined,
      actual: typeof failure.actual === "string" ? failure.actual : undefined,
      files: asStringArray(failure.files),
    });
  }

  return sources;
}

function lastRecord(jsonl: string): Record<string, unknown> | undefined {
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const last = lines[lines.length - 1];
  if (!last) return undefined;
  try {
    return JSON.parse(last) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}
