import { scoreText, tokens } from "./shared-kb";
import type { SharedKbConfidence, SharedKbKind, SharedKbLesson, SharedKbSearchItem, SharedKbSearchResult, SharedKbStatus } from "./shared-kb";

export const CQ_SCHEMA_VERSION = "v1";

// Field shapes mirror cq's published JSON Schema (schema/knowledge_unit.json):
// required [id, domains, insight]; confidence/confirmations live under `evidence`;
// languages/frameworks/pattern under `context`; there is no `kind`/`status`/`severity`.
export interface CqInsight {
  summary?: string;
  detail?: string;
  action?: string;
}

export interface CqContext {
  languages?: string[];
  frameworks?: string[];
  pattern?: string;
}

export interface CqEvidence {
  confidence?: number;
  confirmations?: number;
  first_observed?: string;
  last_confirmed?: string;
}

export interface CqFlag {
  reason?: string;
  timestamp?: string;
  duplicate_of?: string;
}

export interface CqKnowledgeUnit {
  id: string;
  version?: number;
  domains?: string[];
  insight?: CqInsight;
  context?: CqContext;
  evidence?: CqEvidence;
  tier?: "local" | "private" | "public";
  created_by?: string;
  superseded_by?: string;
  flags?: CqFlag[];
}

export interface CqKnowledgeUnitList {
  units: CqKnowledgeUnit[];
  nextCursor: string | null;
}

export function parseKnowledgeUnitList(json: unknown): CqKnowledgeUnitList {
  if (typeof json !== "object" || json === null) throw new Error("cq response missing data array");
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("cq response missing data array");
  const units: CqKnowledgeUnit[] = data.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("cq knowledge unit missing id");
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) throw new Error("cq knowledge unit missing id");
    return entry as CqKnowledgeUnit;
  });
  const cursor = (json as { next_cursor?: unknown }).next_cursor;
  return { units, nextCursor: typeof cursor === "string" ? cursor : null };
}

function cqConfidenceToBand(confidence?: number): SharedKbConfidence {
  const value = typeof confidence === "number" ? confidence : 0;
  if (value >= 0.66) return "high";
  if (value >= 0.33) return "medium";
  return "low";
}

const confidenceRank: Record<SharedKbConfidence, number> = { low: 0, medium: 1, high: 2 };

function cqUnitStatus(unit: CqKnowledgeUnit): SharedKbStatus {
  if (Array.isArray(unit.flags) && unit.flags.length > 0) return "challenged";
  const confidence = unit.evidence?.confidence;
  return typeof confidence === "number" && confidence >= 0.6 ? "trusted" : "reviewed";
}

export function cqUnitToSearchItem(unit: CqKnowledgeUnit): SharedKbSearchItem {
  const insight = unit.insight ?? {};
  const context = unit.context ?? {};
  const evidence = unit.evidence ?? {};
  const title = insight.summary ?? unit.id;
  const summary = [insight.detail, insight.action].filter(Boolean).join(" ").trim();
  const tags = Array.isArray(unit.domains) ? unit.domains : [];
  const kind: SharedKbKind = "lesson"; // cq has no kind taxonomy
  const status = cqUnitStatus(unit);
  const confidence = cqConfidenceToBand(evidence.confidence);
  return {
    id: unit.id,
    kind,
    status,
    title,
    summary,
    tags,
    confidence,
    updated_at: evidence.last_confirmed ?? evidence.first_observed ?? "",
    text: [
      unit.id,
      kind,
      status,
      title,
      summary,
      tags.join(" "),
      insight.summary ?? "",
      insight.detail ?? "",
      insight.action ?? "",
      (context.languages ?? []).join(" "),
      (context.frameworks ?? []).join(" "),
      context.pattern ?? "",
      unit.created_by ?? "",
    ].join(" ").toLowerCase(),
  };
}

export async function cqSearch(options: {
  endpoint: string;
  query: string;
  domains?: string[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<SharedKbSearchResult> {
  const base = options.endpoint.replace(/\/+$/, "");
  const suffix = options.domains && options.domains.length > 0
    ? `?domains=${encodeURIComponent(options.domains.join(","))}`
    : "";
  const url = `${base}/api/v1/knowledge${suffix}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, { headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`cq search failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`cq returned non-JSON from ${url} (content-type ${response.headers.get("content-type") ?? "unknown"}). Is the URL the API base, e.g. https://api.cq.exchange?`);
  }
  const { units } = parseKnowledgeUnitList(parsed);
  const queryTokens = tokens(options.query);
  const results = units
    .map((unit) => cqUnitToSearchItem(unit))
    .map((item) => ({ ...item, score: scoreText(item.text, queryTokens) }))
    .filter((item) => item.score === queryTokens.length)
    .sort((a, b) => b.score - a.score || confidenceRank[b.confidence] - confidenceRank[a.confidence] || a.id.localeCompare(b.id));
  return { query: options.query, results };
}

export interface CqProposeRequest {
  domains: string[];
  insight: { summary: string; detail: string; action: string };
  context?: CqContext;
  created_by?: string;
}

export function buildProvenanceNote(lesson: SharedKbLesson): string {
  const fix = lesson.evidence.has_follow_up_fix ? ", has follow-up fix" : "";
  return `Source: Barry Cache lesson ${lesson.id} (${lesson.evidence.source_type}, ${lesson.evidence.count} observation(s)${fix}).`;
}

export function lessonToCqProposal(lesson: SharedKbLesson, opts: { createdBy?: string } = {}): CqProposeRequest {
  if (!lesson.tags || lesson.tags.length === 0) {
    throw new Error("cq propose requires at least one domain; lesson has no tags");
  }
  const detail = [lesson.problem, lesson.why, buildProvenanceNote(lesson)].filter(Boolean).join("\n\n");
  const patternParts: string[] = [];
  if (lesson.applies_when.length > 0) patternParts.push(`applies when: ${lesson.applies_when.join("; ")}`);
  if (lesson.avoid_when.length > 0) patternParts.push(`avoid when: ${lesson.avoid_when.join("; ")}`);
  const request: CqProposeRequest = {
    domains: lesson.tags,
    insight: { summary: lesson.title, detail, action: lesson.recommendation },
  };
  if (patternParts.length > 0) request.context = { pattern: patternParts.join(" | ") };
  if (opts.createdBy) request.created_by = opts.createdBy;
  return request;
}

export async function cqContribute(options: {
  endpoint: string;
  proposal: CqProposeRequest;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; id?: string; error?: string }> {
  const url = `${options.endpoint.replace(/\/+$/, "")}/api/v1/knowledge`;
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, { method: "POST", headers, body: JSON.stringify(options.proposal) });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, error: text || response.statusText };
  try {
    const parsed = JSON.parse(text) as { data?: { id?: unknown } };
    if (typeof parsed.data?.id === "string") return { ok: true, status: response.status, id: parsed.data.id };
  } catch { /* empty/non-JSON body is acceptable */ }
  return { ok: true, status: response.status };
}
