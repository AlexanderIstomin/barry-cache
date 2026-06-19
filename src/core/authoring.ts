import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { looksLikeAdrSource } from "./adr";
import { exists, readTextIfExists, rel, repoPath, writeIfChanged } from "./fs";
import type { FactRecord } from "./types";
import { validateFact } from "./validate";

export interface CreateFeaturePackOptions {
  repo: string;
  slug: string;
  title: string;
  summary: string;
  dryRun?: boolean;
}

export interface CreateFeaturePackResult {
  route: string;
  dryRun: boolean;
  created: boolean;
  written: string[];
}

export interface DraftFactOptions {
  repo: string;
  route: string;
  id?: string;
  prefix?: string;
  subject: string;
  predicate: string;
  object: string;
  src: string[];
  status?: FactRecord["status"];
  kind?: FactRecord["kind"];
  confidence?: FactRecord["confidence"];
  tags?: string[];
  write?: boolean;
}

export interface DraftFactResult {
  route: string;
  path: string;
  written: boolean;
  fact: FactRecord;
}

export async function createFeaturePack(options: CreateFeaturePackOptions): Promise<CreateFeaturePackResult> {
  const slug = normalizeRequired("slug", options.slug);
  const title = normalizeRequired("title", options.title);
  const summary = normalizeRequired("summary", options.summary);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("--slug must use lowercase letters, numbers, and hyphens");
  }

  const dryRun = options.dryRun ?? false;
  const base = `docs/context/features/${slug}`;
  if (await exists(repoPath(options.repo, base))) throw new Error(`Feature pack already exists: ${slug}`);

  const files = [
    { path: `${base}/README.md`, content: `# ${title}\n\n${summary}\n` },
    { path: `${base}/IDMAP.md`, content: "# ID Map\n" },
    { path: `${base}/KG.adj`, content: "" },
    { path: `${base}/FACTS.jsonl`, content: "" },
  ];
  const written: string[] = [];
  for (const file of files) {
    const status = await writeIfChanged(join(options.repo, file.path), file.content, dryRun);
    if (status === "written" || status === "updated") written.push(file.path);
  }

  return {
    route: slug,
    dryRun,
    created: !dryRun,
    written,
  };
}

function normalizeRequired(name: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`--${name} is required`);
  return normalized;
}

export async function draftFact(options: DraftFactOptions): Promise<DraftFactResult> {
  const route = normalizeRequired("route", options.route);
  const featureDir = repoPath(options.repo, "docs/context/features", route);
  if (!(await exists(featureDir))) throw new Error(`Feature pack not found: ${route}`);

  const fact = buildFact(options);
  const factsPath = join(featureDir, "FACTS.jsonl");
  const relativeFactsPath = rel(options.repo, factsPath);
  const existing = await readExistingFacts(factsPath);
  if (existing.some((item) => item.id === fact.id)) throw new Error(`Fact id already exists in ${route}: ${fact.id}`);

  const idMap = await readIdMapIds(join(featureDir, "IDMAP.md"));
  for (const source of fact.src) {
    if (looksLikeAdrSource(source)) continue;
    if (looksLikeSourceId(source) && !idMap.has(source)) throw new Error(`fact references unknown source id: ${source}`);
  }

  const validation = validateFact(fact);
  if (validation) throw new Error(validation);

  if (options.write) await appendFile(factsPath, `${JSON.stringify(fact)}\n`);
  return {
    route,
    path: relativeFactsPath,
    written: options.write === true,
    fact,
  };
}

function buildFact(options: DraftFactOptions): FactRecord {
  const id = factId(options);
  const fact: FactRecord = {
    id,
    subject: normalizeRequired("subject", options.subject),
    predicate: normalizeRequired("predicate", options.predicate),
    object: normalizeRequired("object", options.object),
    src: options.src,
    status: options.status ?? "active",
    kind: options.kind ?? "implemented",
    updated_at: new Date().toISOString(),
    confidence: options.confidence ?? "high",
  };
  if (options.tags && options.tags.length > 0) fact.tags = options.tags;
  return fact;
}

function factId(options: DraftFactOptions): string {
  if (options.id && options.prefix) throw new Error("Use either --id or --prefix, not both");
  if (options.id) return normalizeRequired("id", options.id);
  if (!options.prefix) throw new Error("Missing required --id or --prefix");
  const prefix = normalizeRequired("prefix", options.prefix);
  if (!/^[A-Z][A-Z0-9_-]*$/.test(prefix)) throw new Error("--prefix must be an uppercase fact id prefix");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${prefix}-${now}-${randomUUID().replace(/-/g, "").slice(0, 4)}`;
}

async function readExistingFacts(path: string): Promise<FactRecord[]> {
  const facts: FactRecord[] = [];
  for (const row of (await readTextIfExists(path)).split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(row) as unknown;
      if (validateFact(parsed) === null) facts.push(parsed as FactRecord);
    } catch {
      // Existing invalid rows are reported by validate; authoring only needs known valid ids.
    }
  }
  return facts;
}

async function readIdMapIds(path: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of (await readTextIfExists(path)).split(/\r?\n/)) {
    const match = row.trim().match(/^-\s+`([^`]+)`\s*(?::|=)\s*(.+)$/);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function looksLikeSourceId(source: string): boolean {
  return /^[A-Z][A-Z0-9_-]*$/.test(source);
}
