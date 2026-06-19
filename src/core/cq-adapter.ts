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
