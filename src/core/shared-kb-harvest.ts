import { exists, listDirs, readTextIfExists, repoPath } from "./fs";
import { listAdrs } from "./adr";
import type { SharedKbKind } from "./shared-kb";

export type HarvestSourceKind = "success" | "failure" | "decision";

export interface HarvestSource {
  kind: HarvestSourceKind;
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
  kind: SharedKbKind;
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
  if (source.kind === "decision") {
    score += 3;
    reasons.push("decision record captures reusable architecture/policy knowledge");
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
  const draft = draftForSource(source, tags);
  const checklist = [
    "Anonymize: remove project, product, customer, and team names; describe the pattern generically.",
    "Strip private file paths (no src/…, app/…), secrets, tokens, non-example URLs, and emails.",
    "Generalize the problem and recommendation so they apply beyond this repository.",
    "Make the recommendation and rationale concrete and actionable.",
    "Drop the lesson entirely if it cannot be safely anonymized.",
  ];
  return { source, gate, draft, checklist, proposeCommand: renderProposeCommand(draft) };
}

function draftForSource(source: HarvestSource, tags: string[]): HarvestDraft {
  const avoid_when = ["the source cannot be safely anonymized"];
  if (source.kind === "failure") {
    return {
      kind: "anti_pattern",
      title: `Avoid: ${shorten(source.summary, 70)}`,
      problem: `Expected ${shorten(source.expected ?? "the intended behavior", 80)}, but observed ${shorten(source.actual ?? "a different result", 80)}.`,
      applies_when: ["similar tasks in this area (generalize before sharing)"],
      recommendation: "Describe the guard or fix that prevents this failure class (rewrite generically).",
      why: "Captured from a validated failure; explain the underlying reason it recurs.",
      avoid_when,
      tags,
      confidence: "medium",
    };
  }
  if (source.kind === "decision") {
    return {
      kind: "decision_pattern",
      title: `Decision: ${shorten(source.summary, 70)}`,
      problem: `A recurring architecture/policy decision: ${shorten(source.summary, 120)} (generalize the context).`,
      applies_when: ["systems facing this design choice (generalize before sharing)"],
      recommendation: "State the chosen approach and when it applies (rewrite generically, no project specifics).",
      why: "Captured from a project decision record; explain the tradeoffs and when this choice is right.",
      avoid_when,
      tags,
      confidence: "low",
    };
  }
  return {
    kind: "lesson",
    title: `Lesson: ${shorten(source.summary, 70)}`,
    problem: shorten(source.summary, 160),
    applies_when: ["similar tasks in this area (generalize before sharing)"],
    recommendation: "Describe the reusable approach that worked here (rewrite generically).",
    why: "Captured from a completed task; explain why this generalizes beyond one repo.",
    avoid_when,
    tags,
    confidence: "low",
  };
}

function renderProposeCommand(draft: HarvestDraft): string {
  const q = (value: string) => `"${value.replaceAll('"', "'")}"`;
  return [
    "barry-cache kb propose lesson",
    `--kind ${draft.kind}`,
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

const CONTEXT_HARVEST_CAP = 50;

/**
 * Bootstrap-harvest the existing context backlog: active `decision` facts,
 * active ADRs, and recorded validation failures. Deliberately excludes
 * repo-specific `implemented`/`test` facts and superseded records, and never
 * includes the `src` file pointers. Output still flows through the
 * agent-in-the-loop sanitize → propose path.
 */
export async function readContextHarvestSources(options: { repo: string }, opts?: { cap?: number }): Promise<{ sources: HarvestSource[]; truncated: boolean }> {
  const sources: HarvestSource[] = [];

  const featuresDir = repoPath(options.repo, "docs/context/features");
  for (const slug of await listDirs(featuresDir)) {
    const text = await readTextIfExists(repoPath(featuresDir, slug, "FACTS.jsonl"));
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      try {
        const fact = JSON.parse(line) as { status?: string; kind?: string; subject?: string; predicate?: string; object?: string };
        if (fact.status === "active" && fact.kind === "decision" && typeof fact.subject === "string") {
          sources.push({ kind: "decision", summary: `${fact.subject} ${fact.predicate ?? ""} ${fact.object ?? ""}`.replace(/\s+/g, " ").trim() });
        }
      } catch {
        // skip malformed fact rows
      }
    }
  }

  if (await exists(repoPath(options.repo, "docs/context/adrs"))) {
    for (const adr of await listAdrs({ repo: options.repo })) {
      if (adr.status !== "active") continue;
      const decision = extractAdrDecision(adr.content);
      sources.push({ kind: "decision", summary: `${adr.title}.${decision ? ` ${decision}` : ""}`.trim() });
    }
  }

  const failureText = await readTextIfExists(repoPath(options.repo, ".context-state/failures/failures.jsonl"));
  for (const line of failureText.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line) as { summary?: string; expected?: string; actual?: string };
      if (typeof record.summary === "string") {
        sources.push({ kind: "failure", summary: record.summary, expected: record.expected, actual: record.actual });
      }
    } catch {
      // skip malformed failure rows
    }
  }

  const cap = opts?.cap ?? CONTEXT_HARVEST_CAP;
  return { sources: sources.slice(0, cap), truncated: sources.length > cap };
}

function extractAdrDecision(content: string): string {
  const start = content.search(/^##\s+Decision\s*$/m);
  if (start === -1) return "";
  const after = content.slice(start).replace(/^##\s+Decision\s*$/m, "");
  const next = after.search(/^##\s/m);
  const section = next === -1 ? after : after.slice(0, next);
  return shorten(section.replace(/\s+/g, " ").trim(), 200);
}
