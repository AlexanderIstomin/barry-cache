import type { SharedKbConfidence, SharedKbKind, SharedKbSearchItem, SharedKbStatus } from "./shared-kb";

export const CQ_SCHEMA_VERSION = "v1";

export interface CqInsight {
  summary?: string;
  detail?: string;
  action?: string;
}

export interface CqKnowledgeUnit {
  id: string;
  version?: number | string;
  domain?: string[];
  insight?: CqInsight;
  language?: string;
  frameworks?: string[];
  environment?: string;
  pattern?: string;
  severity?: string;
  confidence?: number;
  confirmations?: number;
  contributing_orgs?: number;
  status?: string;
  kind?: string;
  first_observed?: string;
  last_confirmed?: string;
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

function cqKindToBarryKind(kind?: string): SharedKbKind {
  if (kind === "pitfall") return "anti_pattern";
  if (kind === "tool-recommendation") return "decision_pattern";
  return "lesson";
}

function cqConfidenceToBand(confidence?: number): SharedKbConfidence {
  const value = typeof confidence === "number" ? confidence : 0;
  if (value >= 0.66) return "high";
  if (value >= 0.33) return "medium";
  return "low";
}

function cqConfidenceToStatus(confidence?: number): SharedKbStatus {
  return typeof confidence === "number" && confidence >= 0.6 ? "trusted" : "reviewed";
}

export function cqUnitToSearchItem(unit: CqKnowledgeUnit): SharedKbSearchItem {
  const insight = unit.insight ?? {};
  const title = insight.summary ?? unit.id;
  const summary = [insight.detail, insight.action].filter(Boolean).join(" ").trim();
  const tags = Array.isArray(unit.domain) ? unit.domain : [];
  const kind = cqKindToBarryKind(unit.kind);
  const status = cqConfidenceToStatus(unit.confidence);
  const confidence = cqConfidenceToBand(unit.confidence);
  return {
    id: unit.id,
    kind,
    status,
    title,
    summary,
    tags,
    confidence,
    updated_at: unit.last_confirmed ?? unit.first_observed ?? "",
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
      unit.language ?? "",
      (unit.frameworks ?? []).join(" "),
      unit.pattern ?? "",
    ].join(" ").toLowerCase(),
  };
}
