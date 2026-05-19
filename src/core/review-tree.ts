import type { FactRecord } from "./types";

export type ReviewTreeGroupBy = "kind" | "predicate" | "source" | "status";
export type ReviewTreeNodeKind = "root" | "feature" | "group" | "fact" | "entity" | "source" | "more";

export interface ReviewTreeFactInput {
  route: string;
  source: string;
  fact: FactRecord;
}

export interface ReviewTreeFeatureSummary {
  slug: string;
  label: string;
  factCount: number;
  entityCount: number;
  sourceCount: number;
  statusCounts: Record<string, number>;
  kindCounts: Record<string, number>;
  predicateCounts: Record<string, number>;
}

export interface ReviewTreeGroup {
  id: string;
  route: string;
  groupBy: ReviewTreeGroupBy;
  value: string;
  factIds: string[];
  factKeys: string[];
}

export interface ReviewTreeNode {
  id: string;
  kind: ReviewTreeNodeKind;
  label: string;
  subtitle?: string;
  route?: string;
  count?: number;
  factId?: string;
  entityId?: string;
  sourceId?: string;
  children: ReviewTreeNode[];
}

export interface ReviewTreeModel {
  root: ReviewTreeNode;
  features: ReviewTreeFeatureSummary[];
  groups: ReviewTreeGroup[];
  factIdsByRoute: Record<string, string[]>;
  factIdsByEntity: Record<string, string[]>;
  factIdsBySource: Record<string, string[]>;
  factKeysByRoute: Record<string, string[]>;
  factKeysByEntity: Record<string, string[]>;
  factKeysBySource: Record<string, string[]>;
}

export function buildReviewTree(facts: ReviewTreeFactInput[]): ReviewTreeModel {
  const byRoute = new Map<string, ReviewTreeFactInput[]>();
  const factIdsByRoute = new Map<string, Set<string>>();
  const factIdsByEntity = new Map<string, Set<string>>();
  const factIdsBySource = new Map<string, Set<string>>();
  const factKeysByRoute = new Map<string, Set<string>>();
  const factKeysByEntity = new Map<string, Set<string>>();
  const factKeysBySource = new Map<string, Set<string>>();
  const groups: ReviewTreeGroup[] = [];

  for (const item of facts) {
    const key = factKey(item);
    pushMapArray(byRoute, item.route, item);
    pushMapSet(factIdsByRoute, item.route, item.fact.id);
    pushMapSet(factIdsByEntity, item.fact.subject, item.fact.id);
    pushMapSet(factIdsByEntity, item.fact.object, item.fact.id);
    for (const source of item.fact.src) pushMapSet(factIdsBySource, source, item.fact.id);
    pushMapSet(factKeysByRoute, item.route, key);
    pushMapSet(factKeysByEntity, item.fact.subject, key);
    pushMapSet(factKeysByEntity, item.fact.object, key);
    for (const source of item.fact.src) pushMapSet(factKeysBySource, source, key);
  }

  const features: ReviewTreeFeatureSummary[] = [];
  const featureNodes: ReviewTreeNode[] = [];

  for (const [route, routeFacts] of [...byRoute.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const entityIds = new Set<string>();
    const sourceIds = new Set<string>();
    const statusCounts: Record<string, number> = {};
    const kindCounts: Record<string, number> = {};
    const predicateCounts: Record<string, number> = {};

    for (const item of routeFacts) {
      entityIds.add(item.fact.subject);
      entityIds.add(item.fact.object);
      for (const source of item.fact.src) sourceIds.add(source);
      increment(statusCounts, item.fact.status);
      increment(kindCounts, item.fact.kind);
      increment(predicateCounts, item.fact.predicate);
    }

    const summary: ReviewTreeFeatureSummary = {
      slug: route,
      label: titleFromSlug(route),
      factCount: routeFacts.length,
      entityCount: entityIds.size,
      sourceCount: sourceIds.size,
      statusCounts: sortedRecord(statusCounts),
      kindCounts: sortedRecord(kindCounts),
      predicateCounts: sortedRecord(predicateCounts),
    };
    features.push(summary);

    for (const groupBy of ["kind", "predicate", "source", "status"] as const) {
      const grouped = groupFacts(routeFacts, groupBy);
      for (const [value, groupFacts] of grouped) {
        groups.push({
          id: `tree:group:${route}:${groupBy}:${slug(value)}`,
          route,
          groupBy,
          value,
          factIds: groupFacts.map((item) => item.fact.id).sort(),
          factKeys: groupFacts.map(factKey).sort(),
        });
      }
    }

    featureNodes.push({
      id: `tree:feature:${route}`,
      kind: "feature",
      label: summary.label,
      route,
      count: routeFacts.length,
      children: [],
    });
  }

  return {
    root: {
      id: "tree:root",
      kind: "root",
      label: "Repository",
      count: facts.length,
      children: featureNodes,
    },
    features,
    groups: groups.sort((a, b) => a.route.localeCompare(b.route) || a.groupBy.localeCompare(b.groupBy) || a.value.localeCompare(b.value)),
    factIdsByRoute: mapSetToRecord(factIdsByRoute),
    factIdsByEntity: mapSetToRecord(factIdsByEntity),
    factIdsBySource: mapSetToRecord(factIdsBySource),
    factKeysByRoute: mapSetToRecord(factKeysByRoute),
    factKeysByEntity: mapSetToRecord(factKeysByEntity),
    factKeysBySource: mapSetToRecord(factKeysBySource),
  };
}

function groupFacts(facts: ReviewTreeFactInput[], groupBy: ReviewTreeGroupBy): Map<string, ReviewTreeFactInput[]> {
  const grouped = new Map<string, ReviewTreeFactInput[]>();
  for (const item of facts) {
    const values = groupValues(item, groupBy);
    for (const value of values) {
      if (!grouped.has(value)) grouped.set(value, []);
      grouped.get(value)!.push(item);
    }
  }
  for (const [value, groupFacts] of grouped) grouped.set(value, groupFacts.sort((a, b) => factKey(a).localeCompare(factKey(b))));
  return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function factKey(item: ReviewTreeFactInput): string {
  return `${item.route}::${item.fact.id}`;
}

function groupValues(item: ReviewTreeFactInput, groupBy: ReviewTreeGroupBy): string[] {
  if (groupBy === "kind") return [item.fact.kind];
  if (groupBy === "predicate") return [item.fact.predicate];
  if (groupBy === "status") return [item.fact.status];
  return item.fact.src.length > 0 ? item.fact.src : ["unsourced"];
}

function pushMapArray<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}

function pushMapSet(map: Map<string, Set<string>>, key: string, value: string): void {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function mapSetToRecord(map: Map<string, Set<string>>): Record<string, string[]> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()]));
}

function titleFromSlug(slug: string): string {
  return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "value";
}
