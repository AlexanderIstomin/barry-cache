import { join } from "node:path";
import { readFeaturePacks } from "./context";
import { readTextIfExists, rel, repoPath } from "./fs";
import type { FactRecord, FeaturePack } from "./types";

export type ReviewNodeKind = "feature" | "fact" | "entity" | "source" | "handoff" | "failure" | "strategy";
export type ReviewEdgeKind = "contains" | "asserts" | "cites" | "supersedes" | "touches" | "related-to";
export type ReviewTimelineKind = "handoff" | "failure" | "strategy";

export interface ReviewNode {
  id: string;
  kind: ReviewNodeKind;
  label: string;
  subtitle?: string;
  source?: string;
  meta: Record<string, unknown>;
}

export interface ReviewEdge {
  id: string;
  source: string;
  target: string;
  kind: ReviewEdgeKind;
  label?: string;
  meta: Record<string, unknown>;
}

export interface ReviewTimelineItem {
  id: string;
  kind: ReviewTimelineKind;
  label: string;
  summary: string;
  timestamp?: string;
  status?: string;
  source: string;
  files: string[];
  meta: Record<string, unknown>;
}

export interface ReviewFactItem {
  route: string;
  source: string;
  fact: FactRecord;
}

export interface ReviewModel {
  generated_at: string;
  repo: string;
  summary: {
    features: number;
    facts: number;
    entities: number;
    sources: number;
    handoffs: number;
    failures: number;
    strategies: number;
    nodes: number;
    edges: number;
  };
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  facts: ReviewFactItem[];
  timeline: ReviewTimelineItem[];
  warnings: string[];
}

interface MutableGraph {
  nodes: Map<string, ReviewNode>;
  edges: Map<string, ReviewEdge>;
}

interface JsonlRecord {
  id?: unknown;
  updated_at?: unknown;
  status?: unknown;
  summary?: unknown;
  title?: unknown;
  files?: unknown;
  tests?: unknown;
  tags?: unknown;
  [key: string]: unknown;
}

export async function buildReviewModel({ repo }: { repo: string }): Promise<ReviewModel> {
  const graph: MutableGraph = { nodes: new Map(), edges: new Map() };
  const warnings: string[] = [];
  const facts: ReviewFactItem[] = [];
  const timeline: ReviewTimelineItem[] = [];
  const features = await readFeaturePacks(repo);

  for (const feature of features) {
    addFeature(graph, repo, feature);
    const sourceMap = parseIdMap(feature.idmap);
    addKgEdges(graph, feature);

    for (const fact of feature.facts) {
      facts.push({
        route: feature.slug,
        source: `${rel(repo, join(feature.dir, "FACTS.jsonl"))}#${fact.id}`,
        fact,
      });
      addFact(graph, repo, feature, fact, sourceMap);
    }
  }

  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    kind: "handoff",
    path: ".context-state/handoffs/handoffs.jsonl",
    warnings,
  }));
  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    kind: "failure",
    path: ".context-state/failures/failure_patterns.jsonl",
    warnings,
  }));
  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    kind: "failure",
    path: ".context-state/failures/failures.jsonl",
    warnings,
  }));
  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    kind: "strategy",
    path: ".context-state/strategies/strategies.jsonl",
    warnings,
  }));

  timeline.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "") || a.id.localeCompare(b.id));

  const nodes = [...graph.nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const edges = [...graph.edges.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return {
    generated_at: new Date().toISOString(),
    repo,
    summary: {
      features: features.length,
      facts: facts.length,
      entities: nodes.filter((node) => node.kind === "entity").length,
      sources: nodes.filter((node) => node.kind === "source").length,
      handoffs: timeline.filter((item) => item.kind === "handoff").length,
      failures: timeline.filter((item) => item.kind === "failure").length,
      strategies: timeline.filter((item) => item.kind === "strategy").length,
      nodes: nodes.length,
      edges: edges.length,
    },
    nodes,
    edges,
    facts: facts.sort((a, b) => a.fact.id.localeCompare(b.fact.id)),
    timeline,
    warnings,
  };
}

function addFeature(graph: MutableGraph, repo: string, feature: FeaturePack): void {
  addNode(graph, {
    id: `feature:${feature.slug}`,
    kind: "feature",
    label: feature.slug,
    subtitle: firstMarkdownHeading(feature.readme) || "Feature context pack",
    source: rel(repo, feature.dir),
    meta: {
      route: feature.slug,
      facts: feature.facts.length,
    },
  });
}

function addFact(
  graph: MutableGraph,
  repo: string,
  feature: FeaturePack,
  fact: FactRecord,
  sourceMap: Map<string, string>,
): void {
  const factId = `fact:${fact.id}`;
  addNode(graph, {
    id: factId,
    kind: "fact",
    label: fact.id,
    subtitle: `${fact.subject} ${fact.predicate} ${fact.object}`,
    source: `${rel(repo, join(feature.dir, "FACTS.jsonl"))}#${fact.id}`,
    meta: {
      route: feature.slug,
      status: fact.status,
      kind: fact.kind,
      confidence: fact.confidence,
      updated_at: fact.updated_at,
      tags: fact.tags ?? [],
    },
  });
  addEdge(graph, {
    source: `feature:${feature.slug}`,
    target: factId,
    kind: "contains",
    meta: { route: feature.slug },
  });

  const subjectId = addEntity(graph, fact.subject);
  const objectId = addEntity(graph, fact.object);
  addEdge(graph, {
    source: factId,
    target: subjectId,
    kind: "asserts",
    label: "subject",
    meta: { predicate: fact.predicate },
  });
  addEdge(graph, {
    source: factId,
    target: objectId,
    kind: "asserts",
    label: fact.predicate,
    meta: { predicate: fact.predicate },
  });

  for (const source of fact.src) {
    const resolved = sourceMap.get(source) ?? source;
    const sourceId = addSource(graph, resolved, { alias: resolved === source ? undefined : source });
    addEdge(graph, {
      source: factId,
      target: sourceId,
      kind: "cites",
      label: source,
      meta: { raw: source },
    });
  }

  for (const superseded of values(fact.supersedes)) {
    addEdge(graph, {
      source: factId,
      target: `fact:${superseded}`,
      kind: "supersedes",
      meta: {},
    });
  }
}

function addKgEdges(graph: MutableGraph, feature: FeaturePack): void {
  for (const line of feature.graph.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(.+?)\s+([^\s]+)\s+(.+)$/);
    if (!match) continue;
    const subject = match[1];
    const predicate = match[2];
    const object = match[3];
    if (!subject || !predicate || !object) continue;
    const source = addEntity(graph, subject.trim());
    const target = addEntity(graph, object.trim());
    addEdge(graph, {
      source,
      target,
      kind: "related-to",
      label: predicate,
      meta: { route: feature.slug },
    });
  }
}

async function addOperationalRecords(options: {
  graph: MutableGraph;
  repo: string;
  kind: ReviewTimelineKind;
  path: string;
  warnings: string[];
}): Promise<ReviewTimelineItem[]> {
  const raw = await readJsonl(repoPath(options.repo, options.path), options.path, options.warnings);
  const items: ReviewTimelineItem[] = [];
  raw.forEach((record, index) => {
    const id = `${options.kind}:${stringValue(record.id) || `${options.path}:${index + 1}`}`;
    const files = arrayOfStrings(record.files);
    const summary = stringValue(record.summary) || stringValue(record.title) || "No summary";
    addNode(options.graph, {
      id,
      kind: options.kind,
      label: truncate(summary, 64),
      subtitle: stringValue(record.status) || options.kind,
      source: `${options.path}#L${index + 1}`,
      meta: record,
    });
    for (const file of files) {
      const sourceId = addSource(options.graph, file, {});
      addEdge(options.graph, {
        source: id,
        target: sourceId,
        kind: "touches",
        meta: { type: "file" },
      });
    }
    const item: ReviewTimelineItem = {
      id,
      kind: options.kind,
      label: truncate(summary, 64),
      summary,
      source: `${options.path}#L${index + 1}`,
      files,
      meta: record,
    };
    const timestamp = stringValue(record.updated_at);
    const status = stringValue(record.status);
    if (timestamp) item.timestamp = timestamp;
    if (status) item.status = status;
    items.push(item);
  });
  return items;
}

async function readJsonl(path: string, displayPath: string, warnings: string[]): Promise<JsonlRecord[]> {
  const rows = (await readTextIfExists(path)).split(/\r?\n/);
  const records: JsonlRecord[] = [];
  rows.forEach((row, index) => {
    if (row.trim().length === 0) return;
    try {
      const parsed = JSON.parse(row) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as JsonlRecord);
      } else {
        warnings.push(`${displayPath}:${index + 1} is not an object`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${displayPath}:${index + 1} ${message}`);
    }
  });
  return records;
}

function addEntity(graph: MutableGraph, label: string): string {
  const id = `entity:${slug(label)}`;
  addNode(graph, {
    id,
    kind: "entity",
    label,
    meta: {},
  });
  return id;
}

function addSource(graph: MutableGraph, label: string, meta: Record<string, unknown>): string {
  const id = `source:${label}`;
  addNode(graph, {
    id,
    kind: "source",
    label,
    meta,
  });
  return id;
}

function addNode(graph: MutableGraph, node: ReviewNode): void {
  const existing = graph.nodes.get(node.id);
  if (!existing) {
    graph.nodes.set(node.id, node);
    return;
  }
  graph.nodes.set(node.id, {
    ...existing,
    ...node,
    meta: {
      ...existing.meta,
      ...node.meta,
    },
  });
}

function addEdge(
  graph: MutableGraph,
  edge: Omit<ReviewEdge, "id"> & { id?: string },
): void {
  const id = edge.id ?? `${edge.kind}:${edge.source}->${edge.target}:${edge.label ?? ""}`;
  if (graph.edges.has(id)) return;
  const next: ReviewEdge = {
    id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    meta: edge.meta,
  };
  if (edge.label !== undefined) next.label = edge.label;
  graph.edges.set(id, next);
}

function parseIdMap(input: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const markdown = trimmed.match(/[-*]\s*`([^`]+)`\s*:\s*(.+)$/);
    const plain = trimmed.match(/[-*]\s*([^:]+)\s*:\s*(.+)$/);
    const match = markdown ?? plain;
    if (!match) continue;
    const rawKey = match[1];
    const rawValue = match[2];
    if (!rawKey || !rawValue) continue;
    const key = stripBackticks(rawKey.trim());
    const value = stripBackticks(rawValue.trim());
    if (key.length > 0 && value.length > 0) map.set(key, value);
  }
  return map;
}

function firstMarkdownHeading(input: string): string {
  const heading = input.split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading?.replace(/^#\s*/, "").trim() ?? "";
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}

function stripBackticks(input: string): string {
  return input.replace(/^`|`$/g, "");
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}...`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function values(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
