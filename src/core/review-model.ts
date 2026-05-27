import { join } from "node:path";
import { adrMatchesSource, type AdrRecord } from "./adr";
import { readContextSnapshot } from "./context-cache";
import { readTextIfExists, rel, repoPath } from "./fs";
import { buildReviewTree, type ReviewTreeModel } from "./review-tree";
import type { FactRecord, FeaturePack } from "./types";

export type ReviewNodeKind = "feature" | "fact" | "entity" | "source" | "adr" | "handoff" | "failure" | "strategy";
export type ReviewEdgeKind = "contains" | "asserts" | "cites" | "supersedes" | "touches" | "related-to";
export type ReviewTimelineKind = "adr" | "fact" | "handoff" | "failure" | "strategy";
export type ReviewSearchKind = "feature" | "fact" | "adr" | "entity" | "source" | "timeline";

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
  route?: string;
  source: string;
  files: string[];
  related: {
    features: string[];
    facts: string[];
    adrs: string[];
    sources: string[];
    challenges: string[];
    fixes: string[];
  };
  meta: Record<string, unknown>;
}

export interface ReviewFactItem {
  route: string;
  source: string;
  fact: FactRecord;
}

export interface ReviewSearchItem {
  id: string;
  kind: ReviewSearchKind;
  label: string;
  subtitle: string;
  source?: string | undefined;
  route?: string | undefined;
  targetId?: string;
  timelineId?: string;
  text: string;
}

export interface ReviewSearchGroup {
  kind: ReviewSearchKind;
  label: string;
  items: ReviewSearchItem[];
}

export interface ReviewTimelineFeature {
  route: string;
  label: string;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  decisions: ReviewTimelineItem[];
  facts: ReviewTimelineItem[];
  operations: ReviewTimelineItem[];
  events: ReviewTimelineItem[];
}

export interface ReviewTimelineView {
  ticks: string[];
  features: ReviewTimelineFeature[];
  operations: ReviewTimelineItem[];
}

export interface ReviewModel {
  generated_at: string;
  repo: string;
  summary: {
    features: number;
    facts: number;
    adrs: number;
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
  tree: ReviewTreeModel;
  timeline: ReviewTimelineItem[];
  timelineView: ReviewTimelineView;
  search: {
    groups: ReviewSearchGroup[];
  };
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
  challenges?: unknown;
  fixes?: unknown;
  [key: string]: unknown;
}

export async function buildReviewModel({ repo }: { repo: string }): Promise<ReviewModel> {
  const graph: MutableGraph = { nodes: new Map(), edges: new Map() };
  const warnings: string[] = [];
  const facts: ReviewFactItem[] = [];
  const timeline: ReviewTimelineItem[] = [];
  const { features, adrs } = await readContextSnapshot(repo);

  for (const adr of adrs) addAdr(graph, adr);

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
      addFact(graph, repo, feature, fact, sourceMap, adrs);
      timeline.push(factTimelineItem(repo, feature, fact, sourceMap, adrs));
    }
  }

  for (const adr of adrs) timeline.push(adrTimelineItem(adr));

  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    features,
    adrs,
    kind: "handoff",
    path: ".context-state/handoffs/handoffs.jsonl",
    warnings,
  }));
  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    features,
    adrs,
    kind: "failure",
    path: ".context-state/failures/failure_patterns.jsonl",
    warnings,
  }));
  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    features,
    adrs,
    kind: "failure",
    path: ".context-state/failures/failures.jsonl",
    warnings,
  }));
  timeline.push(...await addOperationalRecords({
    graph,
    repo,
    features,
    adrs,
    kind: "strategy",
    path: ".context-state/strategies/strategies.jsonl",
    warnings,
  }));

  timeline.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "") || timelineKindRank(a.kind) - timelineKindRank(b.kind) || a.id.localeCompare(b.id));

  const nodes = [...graph.nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const edges = [...graph.edges.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const sortedFacts = facts.sort((a, b) => a.fact.id.localeCompare(b.fact.id));
  const tree = buildReviewTree(sortedFacts);
  const timelineView = buildTimelineView(features, timeline);
  const search = buildSearchModel(nodes, sortedFacts, timeline);
  return {
    generated_at: new Date().toISOString(),
    repo,
    summary: {
      features: features.length,
      facts: facts.length,
      adrs: adrs.length,
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
    facts: sortedFacts,
    tree,
    timeline,
    timelineView,
    search,
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
  adrs: AdrRecord[],
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
    const adr = adrs.find((item) => adrMatchesSource(item, resolved) || adrMatchesSource(item, source));
    const sourceId = adr ? `adr:${adr.id}` : addSource(graph, resolved, { alias: resolved === source ? undefined : source });
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

function addAdr(graph: MutableGraph, adr: AdrRecord): void {
  const nodeId = `adr:${adr.id}`;
  addNode(graph, {
    id: nodeId,
    kind: "adr",
    label: adr.id,
    subtitle: adr.title,
    source: adr.path,
    meta: {
      status: adr.status,
      date: adr.date,
      supersedes: adr.supersedes,
      tags: adr.tags,
    },
  });

  for (const superseded of adr.supersedes) {
    addEdge(graph, {
      source: nodeId,
      target: `adr:${superseded}`,
      kind: "supersedes",
      meta: {},
    });
  }
}

function factTimelineItem(
  repo: string,
  feature: FeaturePack,
  fact: FactRecord,
  sourceMap: Map<string, string>,
  adrs: AdrRecord[],
): ReviewTimelineItem {
  const resolvedSources = fact.src.map((source) => sourceMap.get(source) ?? source);
  const linkedAdrs = resolvedSources
    .map((source) => adrs.find((adr) => adrMatchesSource(adr, source)))
    .filter((adr): adr is AdrRecord => Boolean(adr));
  const sourceFiles = resolvedSources.filter((source) => !linkedAdrs.some((adr) => adrMatchesSource(adr, source)));
  return {
    id: `timeline:fact:${feature.slug}:${fact.id}`,
    kind: "fact",
    label: `${feature.slug}: ${fact.id}`,
    summary: factAssertion(fact),
    timestamp: fact.updated_at,
    status: fact.status,
    route: feature.slug,
    source: `${rel(repo, join(feature.dir, "FACTS.jsonl"))}#${fact.id}`,
    files: sourceFiles,
    related: {
      features: [feature.slug],
      facts: [fact.id],
      adrs: linkedAdrs.map((adr) => adr.id),
      sources: sourceFiles,
      challenges: [],
      fixes: [],
    },
    meta: {
      fact,
      kind: fact.kind,
      confidence: fact.confidence,
      tags: fact.tags ?? [],
    },
  };
}

function adrTimelineItem(adr: AdrRecord): ReviewTimelineItem {
  return {
    id: `timeline:adr:${adr.id}`,
    kind: "adr",
    label: adr.id,
    summary: adr.title,
    timestamp: adr.date,
    status: adr.status,
    source: adr.path,
    files: [adr.path],
    related: {
      features: [],
      facts: [],
      adrs: [adr.id],
      sources: [adr.path],
      challenges: [],
      fixes: [],
    },
    meta: {
      title: adr.title,
      tags: adr.tags,
      supersedes: adr.supersedes,
    },
  };
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
  features: FeaturePack[];
  adrs: AdrRecord[];
  kind: ReviewTimelineKind;
  path: string;
  warnings: string[];
}): Promise<ReviewTimelineItem[]> {
  const raw = await readJsonl(repoPath(options.repo, options.path), options.path, options.warnings);
  const items: ReviewTimelineItem[] = [];
  raw.forEach((record, index) => {
    const id = `${options.kind}:${stringValue(record.id) || `${options.path}:${index + 1}`}`;
    const files = arrayOfStrings(record.files);
    const challenges = arrayOfStrings(record.challenges);
    const fixes = arrayOfStrings(record.fixes);
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
    const related = operationalRecordLinks(options.repo, files, summary, options.features, options.adrs);
    for (const feature of related.features) {
      addEdge(options.graph, {
        source: id,
        target: `feature:${feature}`,
        kind: "related-to",
        label: "feature",
        meta: { type: "operation-feature" },
      });
    }
    for (const adr of related.adrs) {
      addEdge(options.graph, {
        source: id,
        target: `adr:${adr}`,
        kind: "related-to",
        label: "ADR",
        meta: { type: "operation-adr" },
      });
    }
    const item: ReviewTimelineItem = {
      id,
      kind: options.kind,
      label: truncate(summary, 64),
      summary,
      source: `${options.path}#L${index + 1}`,
      files,
      related: {
        features: related.features,
        facts: related.facts,
        adrs: related.adrs,
        sources: files,
        challenges,
        fixes,
      },
      meta: record,
    };
    const inferredRoute = related.features.length === 1 ? related.features[0] : undefined;
    if (inferredRoute) item.route = inferredRoute;
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

function operationalRecordLinks(repo: string, files: string[], summary: string, features: FeaturePack[], adrs: AdrRecord[]): ReviewTimelineItem["related"] {
  const featureSet = new Set<string>();
  const factSet = new Set<string>();
  const adrSet = new Set<string>();
  for (const file of files) {
    for (const adr of adrs) {
      if (adrMatchesSource(adr, file)) adrSet.add(adr.id);
    }
  }
  for (const feature of features) {
    const featureDir = rel(repo, feature.dir);
    if (files.some((file) => sourceMatches(file, featureDir) || stripSourceFragment(file).startsWith(`${featureDir}/`))) {
      featureSet.add(feature.slug);
    }
    const sourceMap = parseIdMap(feature.idmap);
    for (const fact of feature.facts) {
      const resolvedSources = fact.src.map((source) => sourceMap.get(source) ?? source);
      const rawAndResolvedSources = unique([...fact.src, ...resolvedSources]);
      if (!files.some((file) => rawAndResolvedSources.some((source) => sourceMatches(source, file)))) continue;
      featureSet.add(feature.slug);
      factSet.add(fact.id);
      for (const source of resolvedSources) {
        const adr = adrs.find((item) => adrMatchesSource(item, source));
        if (adr) adrSet.add(adr.id);
      }
    }
  }
  if (featureSet.size === 0) addSummaryOperationalLinks(summary, features, adrs, featureSet, factSet, adrSet);
  return {
    features: unique([...featureSet]),
    facts: unique([...factSet]),
    adrs: unique([...adrSet]),
    sources: files,
    challenges: [],
    fixes: [],
  };
}

function addSummaryOperationalLinks(
  summary: string,
  features: FeaturePack[],
  adrs: AdrRecord[],
  featureSet: Set<string>,
  factSet: Set<string>,
  adrSet: Set<string>,
): void {
  const tokens = operationalSummaryTokens(summary);
  if (tokens.length === 0) return;

  const candidates = features
    .map((feature) => summaryFeatureCandidate(feature, tokens, adrs))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.feature.slug.localeCompare(b.feature.slug));
  const selected = candidates[0];
  if (selected) {
    featureSet.add(selected.feature.slug);
    for (const factId of selected.factIds) factSet.add(factId);
    for (const adrId of selected.adrIds) adrSet.add(adrId);
  }

  for (const adr of adrs) {
    const adrScore = operationalTokenScore(tokens, searchText([adr.id, adr.title, adr.path, adr.tags]));
    if (adrScore >= 2) adrSet.add(adr.id);
  }
}

function summaryFeatureCandidate(feature: FeaturePack, tokens: string[], adrs: AdrRecord[]): {
  feature: FeaturePack;
  score: number;
  factIds: string[];
  adrIds: string[];
} {
  const sourceMap = parseIdMap(feature.idmap);
  const factIds: string[] = [];
  const adrIds: string[] = [];
  let maxFactScore = 0;
  let totalFactScore = 0;
  for (const fact of feature.facts) {
    const resolvedSources = fact.src.map((source) => sourceMap.get(source) ?? source);
    const score = operationalTokenScore(tokens, searchText([
      fact.id,
      fact.subject,
      fact.predicate,
      fact.object,
      fact.status,
      fact.kind,
      fact.updated_at,
      fact.tags ?? [],
      fact.src,
      resolvedSources,
    ]));
    if (score < 2) continue;
    factIds.push(fact.id);
    maxFactScore = Math.max(maxFactScore, score);
    totalFactScore += score;
    for (const source of resolvedSources) {
      const adr = adrs.find((item) => adrMatchesSource(item, source));
      if (adr) adrIds.push(adr.id);
    }
  }
  if (factIds.length > 0) {
    return {
      feature,
      score: maxFactScore * 100 + totalFactScore,
      factIds: unique(factIds),
      adrIds: unique(adrIds),
    };
  }

  const featureScore = operationalTokenScore(tokens, searchText([
    feature.slug,
    feature.readme,
    feature.idmap,
    feature.graph,
  ]));
  return {
    feature,
    score: featureScore >= 3 ? featureScore : 0,
    factIds: [],
    adrIds: [],
  };
}

function operationalSummaryTokens(summary: string): string[] {
  return unique(summary.toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeOperationalToken)
    .filter((token) => token.length >= 3));
}

function normalizeOperationalToken(token: string): string {
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function operationalTokenScore(tokens: string[], text: string): number {
  const textTokens = operationalSummaryTokens(text);
  return tokens.reduce((score, token) => {
    return score + (textTokens.some((candidate) => operationalTokensMatch(token, candidate)) ? 1 : 0);
  }, 0);
}

function operationalTokensMatch(left: string, right: string): boolean {
  return left === right || (left.length >= 5 && right.startsWith(left)) || (right.length >= 5 && left.startsWith(right));
}

function sourceMatches(source: string, file: string): boolean {
  const left = stripSourceFragment(source);
  const right = stripSourceFragment(file);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function stripSourceFragment(source: string): string {
  return source.split("#")[0] ?? source;
}

function buildTimelineView(features: FeaturePack[], timeline: ReviewTimelineItem[]): ReviewTimelineView {
  const adrById = new Map(
    timeline
      .filter((item) => item.kind === "adr")
      .flatMap((item) => item.related.adrs.map((adrId) => [adrId, item] as const)),
  );
  const factEvents = timeline.filter((item) => item.kind === "fact");
  const operations = timeline.filter((item) => item.kind === "handoff" || item.kind === "failure" || item.kind === "strategy");
  const groupedOperationIds = new Set<string>();
  const groupedFeatures = features.map((feature) => {
    const featureFacts = factEvents.filter((item) => item.route === feature.slug || item.related.features.includes(feature.slug));
    const decisionFacts = featureFacts.filter((item) => stringValue(item.meta.kind) === "decision");
    const allLinkedAdrIds = unique(featureFacts.flatMap((item) => item.related.adrs));
    const linkedDecisionAdrIds = unique(decisionFacts.flatMap((item) => item.related.adrs));
    const linkedAdrs = linkedDecisionAdrIds
      .map((adrId) => adrById.get(adrId))
      .filter((item): item is ReviewTimelineItem => Boolean(item));
    const featureOperations = sortTimelineItems(operations.filter((item) =>
      item.related.features.includes(feature.slug) || hasStringIntersection(item.related.adrs, allLinkedAdrIds)
    ));
    for (const operation of featureOperations) groupedOperationIds.add(operation.id);
    const standaloneDecisionFacts = decisionFacts.filter((item) => !hasStringIntersection(item.related.adrs, linkedDecisionAdrIds));
    const decisions = sortTimelineItems([...linkedAdrs, ...standaloneDecisionFacts]);
    const facts = sortTimelineItems(featureFacts.filter((item) => stringValue(item.meta.kind) === "implemented"));
    const events = sortTimelineItems([...featureFacts, ...linkedAdrs, ...featureOperations]);
    const timestamps = events.map((item) => item.timestamp).filter((value): value is string => Boolean(value));
    const preciseTimestamps = timestamps.filter(hasTimelineTime);
    const dates = timestamps.map((timestamp) => timelineDate(timestamp)).filter((value): value is string => Boolean(value));
    return {
      route: feature.slug,
      label: firstMarkdownHeading(feature.readme) || feature.slug,
      start: dates[0] ?? "",
      end: dates[dates.length - 1] ?? "",
      startTime: preciseTimestamps[0] ?? timestamps[0] ?? "",
      endTime: preciseTimestamps[preciseTimestamps.length - 1] ?? timestamps[timestamps.length - 1] ?? "",
      decisions,
      facts,
      operations: featureOperations,
      events,
    };
  }).sort(compareTimelineFeatures);

  return {
    ticks: unique(timeline.map((item) => timelineDate(item.timestamp)).filter((value): value is string => Boolean(value))),
    features: groupedFeatures,
    operations: operations.filter((item) => !groupedOperationIds.has(item.id)),
  };
}

function compareTimelineFeatures(a: ReviewTimelineFeature, b: ReviewTimelineFeature): number {
  return timelineFeatureSortTime(a).localeCompare(timelineFeatureSortTime(b))
    || (a.endTime || "").localeCompare(b.endTime || "")
    || a.route.localeCompare(b.route);
}

function timelineFeatureSortTime(feature: ReviewTimelineFeature): string {
  return feature.startTime || feature.start || "9999-12-31T23:59:59.999Z";
}

function sortTimelineItems(items: ReviewTimelineItem[]): ReviewTimelineItem[] {
  return uniqueItems(items, (item) => item.id)
    .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "") || timelineKindRank(a.kind) - timelineKindRank(b.kind) || a.id.localeCompare(b.id));
}

function uniqueItems<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

function timelineDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : value;
}

function hasTimelineTime(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

function buildSearchModel(nodes: ReviewNode[], facts: ReviewFactItem[], timeline: ReviewTimelineItem[]): { groups: ReviewSearchGroup[] } {
  const groups: ReviewSearchGroup[] = [
    { kind: "feature", label: "Features", items: [] },
    { kind: "fact", label: "Facts", items: [] },
    { kind: "adr", label: "ADRs", items: [] },
    { kind: "entity", label: "Entities", items: [] },
    { kind: "source", label: "Sources", items: [] },
    { kind: "timeline", label: "Timeline", items: [] },
  ];
  const byKind = new Map(groups.map((group) => [group.kind, group]));

  for (const node of nodes) {
    if (node.kind !== "feature" && node.kind !== "adr" && node.kind !== "entity" && node.kind !== "source") continue;
    byKind.get(node.kind)?.items.push({
      id: node.id,
      kind: node.kind,
      label: node.label,
      subtitle: node.subtitle ?? node.source ?? node.kind,
      source: node.source,
      route: stringValue(node.meta.route),
      targetId: node.id,
      text: searchText([node.id, node.label, node.subtitle, node.source, ...Object.values(node.meta)]),
    });
  }

  for (const item of facts) {
    const fact = item.fact;
    byKind.get("fact")?.items.push({
      id: `fact:${fact.id}`,
      kind: "fact",
      label: fact.id,
      subtitle: factAssertion(fact),
      source: item.source,
      route: item.route,
      targetId: `fact:${fact.id}`,
      text: searchText([fact.id, item.route, fact.subject, fact.predicate, fact.object, fact.status, fact.kind, fact.updated_at, ...fact.src, ...(fact.tags ?? [])]),
    });
  }

  for (const item of timeline) {
    byKind.get("timeline")?.items.push({
      id: item.id,
      kind: "timeline",
      label: item.label,
      subtitle: [item.timestamp, item.summary].filter(Boolean).join(" · "),
      source: item.source,
      route: item.route,
      timelineId: item.id,
      targetId: item.kind === "fact" && item.related.facts[0] ? `fact:${item.related.facts[0]}` : item.kind === "adr" && item.related.adrs[0] ? `adr:${item.related.adrs[0]}` : item.id,
      text: searchText([item.id, item.kind, item.label, item.summary, item.timestamp, item.status, item.source, item.route, ...item.files, ...item.related.features, ...item.related.facts, ...item.related.adrs, ...item.related.sources, ...item.related.challenges, ...item.related.fixes]),
    });
  }

  for (const group of groups) {
    group.items.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }
  return { groups };
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

function factAssertion(fact: FactRecord): string {
  return `${fact.subject} ${fact.predicate} ${fact.object}`;
}

function timelineKindRank(kind: ReviewTimelineKind): number {
  return { adr: 0, fact: 1, handoff: 2, failure: 3, strategy: 4 }[kind];
}

function searchText(values: unknown[]): string {
  return values.flatMap(searchTokens).join(" ").toLowerCase();
}

function searchTokens(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(searchTokens);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(searchTokens);
  return [String(value)];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function hasStringIntersection(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function values(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
