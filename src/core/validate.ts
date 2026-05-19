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

export async function validateProject({ repo }: { repo: string }): Promise<ValidationResult> {
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
    const rows = (await readTextIfExists(factsPath)).split(/\r?\n/);
    rows.forEach((row, index) => {
      if (row.trim().length === 0) return;
      const line = index + 1;
      try {
        const value = JSON.parse(row) as unknown;
        const message = validateFact(value);
        if (message) errors.push({ file: rel(repo, factsPath), line, message });
        if (!message) {
          const fact = value as FactRecord;
          for (const source of fact.src) {
            if (looksLikeAdrSource(source) && !adrCatalog.adrs.some((adr) => adrMatchesSource(adr, source))) {
              warnings.push({ file: rel(repo, factsPath), line, message: `fact references missing ADR source: ${source}` });
            }
          }
        }
      } catch {
        errors.push({ file: rel(repo, factsPath), line, message: "invalid JSON" });
      }
    });
  }

  return { ok: errors.length === 0, errors, warnings };
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
