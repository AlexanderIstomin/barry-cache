import { join } from "node:path";
import { adrMatchesSource, looksLikeAdrSource, readAdrCatalog } from "./adr";
import { listDirs, rel, repoPath, readTextIfExists, exists } from "./fs";
import type { CommandIssue, FactRecord, ValidationResult } from "./types";

const requiredFiles = [
  "docs/context/INDEX.md",
  "docs/context/LOG.md",
  "docs/context/MAINTENANCE.md",
  "docs/context/schema/fact.schema.json",
];

export async function validateProject({ repo, now = new Date(), staleAfterDays = 180 }: { repo: string; now?: Date; staleAfterDays?: number }): Promise<ValidationResult> {
  const errors: CommandIssue[] = [];
  const warnings: CommandIssue[] = [];
  const adrCatalog = await readAdrCatalog(repo);
  errors.push(...adrCatalog.errors);

  for (const file of requiredFiles) {
    if (!(await exists(repoPath(repo, file)))) {
      errors.push({ file, message: "required context file is missing" });
    }
  }

  const featureRoot = repoPath(repo, "docs/context/features");
  const features = await listDirs(featureRoot);
  for (const slug of features) {
    const factsPath = join(featureRoot, slug, "FACTS.jsonl");
    if (!(await exists(factsPath))) {
      warnings.push({ file: rel(repo, factsPath), message: "feature pack has no FACTS.jsonl" });
      continue;
    }
    const idMapPath = join(featureRoot, slug, "IDMAP.md");
    const graphPath = join(featureRoot, slug, "KG.adj");
    const idMap = await validateIdMap(repo, idMapPath);
    errors.push(...idMap.errors);
    errors.push(...await validateGraph(repo, graphPath));
    const idmap = await readIdmapTokens(idMapPath);
    const seenFactIds = new Set<string>();
    const rows = (await readTextIfExists(factsPath)).split(/\r?\n/);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] ?? "";
      if (row.trim().length === 0) continue;
      const line = index + 1;
      let value: unknown;
      try {
        value = JSON.parse(row) as unknown;
      } catch {
        errors.push({ file: rel(repo, factsPath), line, message: "invalid JSON" });
        continue;
      }
      if (hasStringField(value, "id")) {
        const id = value.id;
        if (seenFactIds.has(id)) {
          errors.push({ file: rel(repo, factsPath), line, message: `duplicate fact id in feature pack: ${id}` });
        }
        seenFactIds.add(id);
      }
      const messages = validateFactErrors(value);
      for (const message of messages) errors.push({ file: rel(repo, factsPath), line, message });
      if (messages.length > 0) continue;
      const fact = value as FactRecord;
      for (const source of fact.src) {
        if (looksLikeAdrSource(source)) {
          if (!adrCatalog.adrs.some((adr) => adrMatchesSource(adr, source))) {
            warnings.push({ file: rel(repo, factsPath), line, message: `fact references missing ADR source: ${source}` });
          }
          continue;
        }
        if (looksLikeSourceId(source) && !idMap.ids.has(source)) {
          errors.push({ file: rel(repo, factsPath), line, message: `fact references unknown source id: ${source}` });
          continue;
        }
        // Drift / provenance-rot: resolve IDMAP tokens (or treat path-like sources as paths)
        // and warn when the referenced file no longer exists.
        const resolved = idmap.get(source) ?? (source.includes("/") ? source : undefined);
        if (resolved && !(await exists(repoPath(repo, resolved)))) {
          const label = idmap.has(source) ? `${resolved} (${source})` : resolved;
          warnings.push({ file: rel(repo, factsPath), line, message: `fact references missing source file: ${label}` });
        }
      }
      // Drift / staleness: aged open questions and risks need a human to revisit.
      if (fact.kind === "open-question" || fact.kind === "risk") {
        const ageDays = factAgeDays(fact.updated_at, now);
        if (ageDays !== null && ageDays > staleAfterDays) {
          warnings.push({ file: rel(repo, factsPath), line, message: `stale ${fact.kind} not updated in ${Math.floor(ageDays)} days: ${fact.id}` });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function readIdmapTokens(path: string): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  const text = await readTextIfExists(path);
  for (const line of text.split(/\r?\n/)) {
    // Parse the same rows validateIdMap accepts (trimmed, `:` or `=` separator), so every
    // token recognized as a valid source id is also resolvable for drift detection.
    const match = /^-\s+`([^`]+)`\s*(?::|=)\s*(.+)$/.exec(line.trim());
    if (match && match[1] && match[2]) tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function factAgeDays(updatedAt: string, now: Date): number | null {
  const updated = new Date(updatedAt);
  const ms = updated.getTime();
  if (Number.isNaN(ms)) return null;
  return (now.getTime() - ms) / 86_400_000;
}

export function validateFact(value: unknown): string | null {
  return validateFactErrors(value)[0] ?? null;
}

function validateFactErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["fact must be an object"];
  const fact = value as Partial<FactRecord>;
  const errors: string[] = [];
  const required: Array<keyof FactRecord> = ["id", "subject", "predicate", "object", "src", "status", "kind", "updated_at"];
  for (const key of required) {
    if (fact[key] === undefined) errors.push(`missing required field: ${key}`);
  }
  for (const key of ["id", "subject", "predicate", "object", "status", "kind", "updated_at"] as const) {
    if (fact[key] !== undefined && (typeof fact[key] !== "string" || fact[key]!.length === 0)) errors.push(`invalid field: ${key}`);
  }
  if (typeof fact.status === "string" && !factStatuses.has(fact.status as FactRecord["status"])) errors.push("invalid field: status");
  if (typeof fact.kind === "string" && !factKinds.has(fact.kind as FactRecord["kind"])) errors.push("invalid field: kind");
  if (typeof fact.updated_at === "string" && !isIsoLikeTimestamp(fact.updated_at)) errors.push("invalid field: updated_at");
  if (!Array.isArray(fact.src) || fact.src.length === 0 || fact.src.some((item) => typeof item !== "string")) {
    errors.push("invalid field: src");
  }
  if (fact.confidence !== undefined && !factConfidences.has(fact.confidence)) errors.push("invalid field: confidence");
  if (fact.tags !== undefined && (!Array.isArray(fact.tags) || fact.tags.some((item) => typeof item !== "string"))) {
    errors.push("invalid field: tags");
  }
  return errors;
}

const factStatuses = new Set<FactRecord["status"]>(["active", "superseded", "deprecated", "missing", "conflict"]);
const factKinds = new Set<FactRecord["kind"]>(["implemented", "decision", "constraint", "test", "risk", "open-question"]);
const factConfidences = new Set<NonNullable<FactRecord["confidence"]>>(["low", "medium", "high"]);

async function validateIdMap(repo: string, path: string): Promise<{ ids: Set<string>; errors: CommandIssue[] }> {
  const file = rel(repo, path);
  const ids = new Set<string>();
  const errors: CommandIssue[] = [];
  const rows = (await readTextIfExists(path)).split(/\r?\n/);
  rows.forEach((row, index) => {
    const trimmed = row.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;
    const idMatch = trimmed.match(/^-\s+`([^`]+)`\s*(?::|=)\s*(.+)$/);
    if (idMatch?.[1]) {
      ids.add(idMatch[1]);
      return;
    }
    if (/^-\s+`[^`]+`/.test(trimmed)) {
      errors.push({ file, line: index + 1, message: "invalid ID map entry" });
    }
  });
  return { ids, errors };
}

async function validateGraph(repo: string, path: string): Promise<CommandIssue[]> {
  const file = rel(repo, path);
  const errors: CommandIssue[] = [];
  const rows = (await readTextIfExists(path)).split(/\r?\n/);
  rows.forEach((row, index) => {
    const trimmed = row.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;
    if (trimmed.split(/\s+/).length < 3) {
      errors.push({ file, line: index + 1, message: "invalid graph row" });
    }
  });
  return errors;
}

function looksLikeSourceId(source: string): boolean {
  return /^[A-Z][A-Z0-9_-]*$/.test(source);
}

function isIsoLikeTimestamp(value: string | undefined): boolean {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function hasStringField<K extends string>(value: unknown, key: K): value is Record<K, string> {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[key] === "string";
}
