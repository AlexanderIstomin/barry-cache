import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { adrToText, linkedAdrsForSources, type AdrRecord } from "./adr";
import { readContextSnapshot } from "./context-cache";
import { rel, repoPath } from "./fs";
import type { FactRecord, FeaturePack, RouteMatch } from "./types";

export interface RouteResult {
  task: string;
  routes: RouteMatch[];
}

export interface SearchResult {
  query: string;
  results: Array<{
    type: "fact" | "feature" | "adr";
    id: string;
    route: string;
    score: number;
    text: string;
    source: string;
  }>;
}

export async function routeTask({ repo, task }: { repo: string; task: string }): Promise<RouteResult> {
  const { features, adrs } = await readContextSnapshot(repo);
  const taskTokens = tokens(task);
  const routes = features
    .map((feature) => scoreFeature(feature, taskTokens, adrs))
    .filter((route) => route.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return { task, routes };
}

export async function searchContext({ repo, query }: { repo: string; query: string }): Promise<SearchResult> {
  const { features, adrs } = await readContextSnapshot(repo);
  const queryTokens = tokens(query);
  const results: SearchResult["results"] = [];

  for (const feature of features) {
    const featureText = `${feature.slug} ${feature.readme}`;
    const featureScore = scoreText(featureText, queryTokens);
    if (featureScore > 0) {
      results.push({
        type: "feature",
        id: feature.slug,
        route: feature.slug,
        score: featureScore,
        text: firstLine(feature.readme) || feature.slug,
        source: rel(repo, feature.dir),
      });
    }
    for (const fact of feature.facts) {
      const factText = factToText(fact);
      const score = scoreText(factText, queryTokens);
      if (score > 0) {
        results.push({
          type: "fact",
          id: fact.id,
          route: feature.slug,
          score,
          text: factText,
          source: `${rel(repo, join(feature.dir, "FACTS.jsonl"))}#${fact.id}`,
        });
      }
    }
  }

  for (const adr of adrs) {
    const score = scoreText(adrToText(adr), queryTokens);
    if (score > 0) {
      results.push({
        type: "adr",
        id: adr.id,
        route: "adrs",
        score,
        text: adr.title,
        source: adr.path,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { query, results };
}

export async function loadContext({ repo, route }: { repo: string; route: string }): Promise<{
  feature: FeaturePack | null;
  facts: FactRecord[];
  sources: string[];
  adrs: AdrRecord[];
}> {
  const { features, adrs } = await readContextSnapshot(repo);
  const feature = features.find((item) => item.slug === route) ?? null;
  if (!feature) return { feature: null, facts: [], sources: [], adrs: [] };
  return {
    feature,
    facts: feature.facts,
    sources: [
      rel(repo, join(feature.dir, "README.md")),
      rel(repo, join(feature.dir, "IDMAP.md")),
      rel(repo, join(feature.dir, "KG.adj")),
      rel(repo, join(feature.dir, "FACTS.jsonl")),
    ],
    adrs: linkedAdrsForSources(feature.facts.flatMap((fact) => fact.src), adrs),
  };
}

export async function resumeProject({ repo, task }: { repo: string; task: string }): Promise<{
  task: string;
  context: RouteResult;
  execution_contract: {
    task_goal: string;
    first_action: string;
    edit_scope: string[];
    validation_commands: string[];
    contract_strength: "soft";
  };
}> {
  const context = await routeTask({ repo, task });
  const selected = context.routes.slice(0, 3).map((route) => route.slug);
  const firstAction = selected.length > 0
    ? `load ${selected.join(", ")} context packs`
    : "load docs/context/INDEX.md and identify the smallest relevant context pack";
  return {
    task,
    context,
    execution_contract: {
      task_goal: task,
      first_action: firstAction,
      edit_scope: selected.map((slug) => `docs/context/features/${slug}/**`),
      validation_commands: ["barry-cache validate"],
      contract_strength: "soft",
    },
  };
}

export async function finalizeProject(options: {
  repo: string;
  status: "success" | "partial" | "blocked" | "failed";
  summary: string;
  files?: string[];
  tests?: string[];
}): Promise<{ saved: boolean; path: string; summary: string }> {
  const dir = repoPath(options.repo, ".context-state/handoffs");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "handoffs.jsonl");
  const record = {
    id: `handoff-${new Date().toISOString()}`,
    updated_at: new Date().toISOString(),
    status: options.status,
    summary: options.summary,
    files: options.files ?? [],
    tests: options.tests ?? [],
  };
  await appendFile(path, `${JSON.stringify(record)}\n`);
  return { saved: true, path: rel(options.repo, path), summary: options.summary };
}

export async function readFeaturePacks(repo: string): Promise<FeaturePack[]> {
  return (await readContextSnapshot(repo)).features;
}

function scoreFeature(feature: FeaturePack, taskTokens: string[], adrs: AdrRecord[]): RouteMatch {
  const linkedAdrs = linkedAdrsForSources(feature.facts.flatMap((fact) => fact.src), adrs);
  const text = [
    feature.slug,
    basename(feature.dir),
    feature.readme,
    feature.idmap,
    feature.graph,
    ...feature.facts.map(factToText),
    ...linkedAdrs.map(adrToText),
  ].join(" ");
  const score = scoreText(text, taskTokens);
  return {
    slug: feature.slug,
    score,
    reason: score > 0 ? `matched ${score} task token${score === 1 ? "" : "s"}` : "no match",
  };
}

function scoreText(text: string, queryTokens: string[]): number {
  const haystack = text.toLowerCase();
  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function tokens(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

function factToText(fact: FactRecord): string {
  return [
    fact.id,
    fact.subject,
    fact.predicate,
    fact.object,
    fact.status,
    fact.kind,
    ...fact.src,
    ...(fact.tags ?? []),
  ].join(" ");
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.replace(/^#\s*/, "") ?? "";
}
