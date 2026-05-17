import { join } from "node:path";
import { listDirs, readTextIfExists, repoPath, writeIfChanged } from "./fs";
import type { FactRecord } from "./types";

export interface ImportPulpcutKbOptions {
  repo: string;
  from: string;
  dryRun?: boolean;
}

export interface ImportPulpcutKbResult {
  source: string;
  source_type: "pulpcut-kb";
  dryRun: boolean;
  imported: number;
  features: string[];
  written: string[];
  updated: string[];
  skipped: string[];
  warnings: string[];
}

interface PulpcutFact {
  id?: unknown;
  s?: unknown;
  p?: unknown;
  o?: unknown;
  src?: unknown;
  corrects?: unknown;
  fact?: unknown;
}

interface RouteInfo {
  useFor: string;
  add: string;
}

export async function importPulpcutKb(options: ImportPulpcutKbOptions): Promise<ImportPulpcutKbResult> {
  const dryRun = options.dryRun ?? false;
  const result: ImportPulpcutKbResult = {
    source: options.from,
    source_type: "pulpcut-kb",
    dryRun,
    imported: 0,
    features: [],
    written: [],
    updated: [],
    skipped: [],
    warnings: [],
  };

  const sourceDocs = repoPath(options.from, "docs");
  const kbIndex = await readTextIfExists(join(sourceDocs, "KB_INDEX.md"));
  if (kbIndex.trim().length === 0) {
    throw new Error(`PulpCut KB index not found at ${join(sourceDocs, "KB_INDEX.md")}`);
  }

  const routes = parseKbIndex(kbIndex);
  const slugs = await listDirs(sourceDocs);
  for (const slug of slugs) {
    const sourceDir = join(sourceDocs, slug);
    const rawFacts = await readTextIfExists(join(sourceDir, "FACTS.jsonl"));
    if (rawFacts.trim().length === 0) continue;

    const idmap = await readTextIfExists(join(sourceDir, "IDMAP.md"));
    const graph = await readTextIfExists(join(sourceDir, "KG.adj"));
    if (idmap.trim().length === 0) result.warnings.push(`${slug}: missing IDMAP.md`);
    if (graph.trim().length === 0) result.warnings.push(`${slug}: missing KG.adj`);

    const facts = parsePulpcutFacts(rawFacts, slug, result.warnings);
    const route = routes.get(slug);
    const targetPrefix = `docs/context/features/${slug}`;
    await writePlanned(options.repo, result, `${targetPrefix}/README.md`, featureReadme(slug, route, idmap), dryRun);
    await writePlanned(options.repo, result, `${targetPrefix}/IDMAP.md`, normalizeText(idmap), dryRun);
    await writePlanned(options.repo, result, `${targetPrefix}/KG.adj`, normalizeText(graph), dryRun);
    await writePlanned(options.repo, result, `${targetPrefix}/FACTS.jsonl`, facts.map((fact) => JSON.stringify(fact)).join("\n") + "\n", dryRun);

    result.imported++;
    result.features.push(slug);
  }

  if (result.imported === 0) {
    result.warnings.push("No PulpCut KB feature folders with FACTS.jsonl were found.");
  }
  result.features.sort();
  return result;
}

function parsePulpcutFacts(input: string, slug: string, warnings: string[]): FactRecord[] {
  const facts: FactRecord[] = [];
  const seen = new Set<string>();
  input.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().length === 0) return;
    let parsed: PulpcutFact;
    try {
      parsed = JSON.parse(line) as PulpcutFact;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${slug}/FACTS.jsonl:${index + 1} invalid JSON: ${message}`);
      return;
    }

    const id = stringValue(parsed.id);
    const subject = stringValue(parsed.s);
    const predicate = stringValue(parsed.p);
    const object = objectValue(parsed.o);
    const src = arrayOfStrings(parsed.src);
    if (!id || !subject || !predicate || !object || src.length === 0) {
      warnings.push(`${slug}/FACTS.jsonl:${index + 1} skipped row with missing id/s/p/o/src`);
      return;
    }
    if (seen.has(id)) warnings.push(`${slug}/FACTS.jsonl:${index + 1} duplicate fact id ${id}`);
    seen.add(id);

    const fact: FactRecord = {
      id,
      subject,
      predicate,
      object,
      src,
      status: "active",
      kind: inferKind(predicate, object),
      confidence: "high",
      updated_at: new Date().toISOString(),
    };
    const supersedes = stringOrStringArray(parsed.corrects);
    if (supersedes) fact.supersedes = supersedes;
    const tags = stringValue(parsed.fact) ? ["pulpcut-import", "fact-note"] : ["pulpcut-import"];
    fact.tags = tags;
    facts.push(fact);
  });
  return facts;
}

function inferKind(predicate: string, object: string): FactRecord["kind"] {
  const text = `${predicate} ${object}`.toLowerCase();
  if (text.includes("test") || text.includes("verifies") || text.includes("coverage")) return "test";
  if (text.includes("risk")) return "risk";
  if (text.includes("missing") || text.includes("unknown") || text.includes("question")) return "open-question";
  if (text.includes("decision")) return "decision";
  if (text.includes("rule") || text.includes("requires") || text.includes("must") || text.includes("only when")) return "constraint";
  return "implemented";
}

function parseKbIndex(input: string): Map<string, RouteInfo> {
  const routes = new Map<string, RouteInfo>();
  let current: string | null = null;
  for (const line of input.split(/\r?\n/)) {
    const routeMatch = line.match(/^-\s+`([^`]+)`\s*$/);
    if (routeMatch?.[1]) {
      current = routeMatch[1];
      routes.set(current, { useFor: "", add: "" });
      continue;
    }
    if (!current) continue;
    const route = routes.get(current);
    if (!route) continue;
    const useFor = line.match(/^\s+-\s+Use for:\s*(.+)$/);
    if (useFor?.[1]) route.useFor = useFor[1].trim();
    const add = line.match(/^\s+-\s+Add:\s*(.+)$/);
    if (add?.[1]) route.add = add[1].trim();
  }
  return routes;
}

function featureReadme(slug: string, route: RouteInfo | undefined, idmap: string): string {
  const scope = extractScope(idmap);
  const sections = [
    `# ${titleFromSlug(slug)}`,
    "",
    "Imported from a PulpCut KB feature folder.",
    "",
  ];
  if (route?.useFor) {
    sections.push("## Route", "", route.useFor, "");
  }
  if (route?.add) {
    sections.push("## Secondary Context", "", route.add, "");
  }
  if (scope) {
    sections.push("## Source Scope", "", scope, "");
  }
  return `${sections.join("\n").trimEnd()}\n`;
}

function extractScope(idmap: string): string {
  const lines = idmap.split(/\r?\n/);
  const scope: string[] = [];
  let inScope = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inScope) break;
      inScope = /^##\s+Scope\b/.test(line);
      continue;
    }
    if (inScope && line.trim().length > 0) scope.push(line.replace(/^\s*-\s*/, ""));
  }
  return scope.join("\n");
}

async function writePlanned(
  repo: string,
  result: ImportPulpcutKbResult,
  path: string,
  content: string,
  dryRun: boolean,
): Promise<void> {
  const status = await writeIfChanged(repoPath(repo, path), content, dryRun);
  if (status === "written") result.written.push(path);
  if (status === "updated") result.updated.push(path);
  if (status === "skipped") result.skipped.push(path);
}

function normalizeText(input: string): string {
  return input.trimEnd().length === 0 ? "" : `${input.trimEnd()}\n`;
}

function titleFromSlug(slug: string): string {
  return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function stringOrStringArray(value: unknown): string | string[] | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  const values = arrayOfStrings(value);
  return values.length > 0 ? values : undefined;
}
