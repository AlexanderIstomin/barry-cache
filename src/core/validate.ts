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
    const idmap = await readIdmapTokens(join(featureRoot, slug, "IDMAP.md"));
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
      const message = validateFact(value);
      if (message) {
        errors.push({ file: rel(repo, factsPath), line, message });
        continue;
      }
      const fact = value as FactRecord;
      for (const source of fact.src) {
        if (looksLikeAdrSource(source)) {
          if (!adrCatalog.adrs.some((adr) => adrMatchesSource(adr, source))) {
            warnings.push({ file: rel(repo, factsPath), line, message: `fact references missing ADR source: ${source}` });
          }
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
    const match = /^-\s*`([^`]+)`:\s*(\S.*?)\s*$/.exec(line);
    if (match && match[1] && match[2]) tokens.set(match[1], match[2]);
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
  if (typeof value !== "object" || value === null) return "fact must be an object";
  const fact = value as Partial<FactRecord>;
  const required: Array<keyof FactRecord> = ["id", "subject", "predicate", "object", "src", "status", "kind", "updated_at"];
  for (const key of required) {
    if (fact[key] === undefined) return `missing required field: ${key}`;
  }
  for (const key of ["id", "subject", "predicate", "object", "status", "kind", "updated_at"] as const) {
    if (typeof fact[key] !== "string" || fact[key]!.length === 0) return `invalid field: ${key}`;
  }
  if (!Array.isArray(fact.src) || fact.src.length === 0 || fact.src.some((item) => typeof item !== "string")) {
    return "invalid field: src";
  }
  if (fact.tags !== undefined && (!Array.isArray(fact.tags) || fact.tags.some((item) => typeof item !== "string"))) {
    return "invalid field: tags";
  }
  return null;
}
