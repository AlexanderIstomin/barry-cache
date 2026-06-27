import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { adrToText, linkedAdrsForSources, type AdrRecord } from "./adr";
import { readContextSnapshot } from "./context-cache";
import { rel, repoPath } from "./fs";
import { budgetContext, type BudgetedContext } from "./budget";
import { getCounter } from "./tokens";
import type { FactRecord, FeaturePack, LoadedFeature, RouteMatch } from "./types";
import { scoreText, tokens } from "./text";
import {
  readWorkspaceConfig,
  selectWorkspace,
  workspaceEditScopes,
  workspaceRouteBoost,
  workspaceRouteScope,
  workspaceSelectionOptions,
  type WorkspaceConfig,
  type WorkspaceDecision,
} from "./workspaces";

export type FinalizeStatus = "success" | "partial" | "blocked" | "failed";
export type ValidationFailureStatus = "open" | "fixed" | "wontfix";

export interface RouteResult {
  task: string;
  routes: RouteMatch[];
  workspace_decision?: WorkspaceDecision;
}

export interface SearchResult {
  query: string;
  workspace_decision?: WorkspaceDecision;
  results: Array<{
    type: "fact" | "feature" | "adr";
    id: string;
    route: string;
    score: number;
    text: string;
    source: string;
  }>;
}

export interface WorkspaceRequest {
  workspace?: string;
  paths?: string[];
}

interface WorkspaceContextRequest extends WorkspaceRequest {
  workspaceConfig?: WorkspaceConfig;
}

export async function routeTask({ repo, task, workspace, paths = [], workspaceConfig: providedWorkspaceConfig }: { repo: string; task: string } & WorkspaceContextRequest): Promise<RouteResult> {
  const { features, adrs } = await readContextSnapshot(repo);
  const workspaceConfig = providedWorkspaceConfig ?? await readWorkspaceConfig(repo);
  const workspaceDecision = shouldSelectWorkspace(workspaceConfig, workspace, paths)
    ? selectWorkspace(workspaceConfig, workspaceSelectionOptions(task, paths, workspace))
    : undefined;
  const routeScope = workspaceRouteScope(workspaceConfig, workspaceDecision);
  const taskTokens = tokens(task);
  const routes = features
    .map((feature) => applyWorkspaceRouteBoost(scoreFeature(feature, taskTokens, adrs), routeScope, workspaceDecision))
    .filter((route) => route.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return withWorkspaceDecision({ task, routes }, workspaceDecision);
}

export async function searchContext({ repo, query, workspace, paths = [] }: { repo: string; query: string } & WorkspaceRequest): Promise<SearchResult> {
  const { features, adrs } = await readContextSnapshot(repo);
  const workspaceConfig = await readWorkspaceConfig(repo);
  const workspaceDecision = shouldSelectWorkspace(workspaceConfig, workspace, paths)
    ? selectWorkspace(workspaceConfig, workspaceSelectionOptions(query, paths, workspace))
    : undefined;
  const routeScope = workspaceRouteScope(workspaceConfig, workspaceDecision);
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

  for (const result of results) {
    result.score = applyWorkspaceResultBoost(result.route, result.score, routeScope);
  }

  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return withWorkspaceDecision({ query, results }, workspaceDecision);
}

export async function loadContext({ repo, route }: { repo: string; route: string }): Promise<{
  feature: LoadedFeature | null;
  facts: FactRecord[];
  sources: string[];
  adrs: AdrRecord[];
}> {
  const { features, adrs } = await readContextSnapshot(repo);
  const feature = features.find((item) => item.slug === route) ?? null;
  if (!feature) return { feature: null, facts: [], sources: [], adrs: [] };
  // Carry facts once (top-level); `feature` is the pack metadata + prose without
  // its facts array, so the load output does not duplicate the facts.
  const { facts, ...slim } = feature;
  return {
    feature: slim,
    facts,
    sources: [
      rel(repo, join(feature.dir, "README.md")),
      rel(repo, join(feature.dir, "IDMAP.md")),
      rel(repo, join(feature.dir, "KG.adj")),
      rel(repo, join(feature.dir, "FACTS.jsonl")),
    ],
    adrs: linkedAdrsForSources(facts.flatMap((fact) => fact.src), adrs),
  };
}

export async function resumeProject({ repo, task, budget, workspace, paths = [] }: { repo: string; task: string; budget?: number } & WorkspaceRequest): Promise<{
  task: string;
  context: RouteResult;
  workspace_decision?: WorkspaceDecision;
  execution_contract: {
    task_goal: string;
    first_action: string;
    edit_scope: string[];
    validation_commands: string[];
    contract_strength: "soft";
  };
  context_preview?: BudgetedContext;
}> {
  const workspaceConfig = await readWorkspaceConfig(repo);
  const routeOptions: { repo: string; task: string } & WorkspaceContextRequest = { repo, task, paths, workspaceConfig };
  if (workspace !== undefined) routeOptions.workspace = workspace;
  const context = await routeTask(routeOptions);
  const workspaceDecision = context.workspace_decision;
  if (workspaceDecision?.status === "ambiguous") {
    return withWorkspaceDecision({
      task,
      context,
      execution_contract: {
        task_goal: task,
        first_action: `resolve workspace ambiguity (${(workspaceDecision.candidates ?? []).join(", ")}) — ${workspaceDecision.required_action}`,
        edit_scope: [],
        validation_commands: ["barry-cache validate"],
        contract_strength: "soft" as const,
      },
    }, workspaceDecision);
  }
  const selected = context.routes.slice(0, 3).map((route) => route.slug);
  const firstAction = resumeFirstAction(selected, workspaceDecision);
  const editScope = resumeEditScope(selected, workspaceConfig, workspaceDecision);
  const base = {
    task,
    context,
    execution_contract: {
      task_goal: task,
      first_action: firstAction,
      edit_scope: editScope,
      validation_commands: ["barry-cache validate"],
      contract_strength: "soft" as const,
    },
  };
  const resultBase = withWorkspaceDecision(base, workspaceDecision);
  if (budget === undefined || selected.length === 0) return resultBase;
  const loaded = await loadContext({ repo, route: selected[0]! });
  if (loaded.feature === null) return resultBase;
  return {
    ...resultBase,
    context_preview: budgetContext({
      feature: loaded.feature,
      facts: loaded.facts,
      adrs: loaded.adrs,
      sources: loaded.sources,
      task,
      budget,
      counter: getCounter(),
    }),
  };
}

export async function finalizeProject(options: {
  repo: string;
  status: FinalizeStatus;
  summary: string;
  files?: string[];
  tests?: string[];
  fixes?: string[];
}): Promise<{ saved: boolean; path: string; id: string; status: FinalizeStatus; summary: string }> {
  const dir = repoPath(options.repo, ".context-state/handoffs");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "handoffs.jsonl");
  const now = new Date().toISOString();
  const id = operationId("handoff", now);
  const record = {
    id,
    updated_at: now,
    status: options.status,
    summary: options.summary,
    files: options.files ?? [],
    tests: options.tests ?? [],
    fixes: options.fixes ?? [],
  };
  await appendFile(path, `${JSON.stringify(record)}\n`);
  return { saved: true, path: rel(options.repo, path), id, status: options.status, summary: options.summary };
}

export async function recordValidationFailure(options: {
  repo: string;
  summary: string;
  expected: string;
  actual: string;
  status?: ValidationFailureStatus;
  reporter?: string;
  files?: string[];
  challenges?: string[];
  fixes?: string[];
}): Promise<{ saved: boolean; path: string; id: string; status: ValidationFailureStatus; summary: string }> {
  const dir = repoPath(options.repo, ".context-state/failures");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "failures.jsonl");
  const status = options.status ?? "open";
  const now = new Date().toISOString();
  const id = operationId("failure", now);
  const record = {
    id,
    kind: "validation_failure",
    observed_at: now,
    updated_at: now,
    status,
    summary: options.summary,
    expected: options.expected,
    actual: options.actual,
    reporter: options.reporter ?? "user",
    files: options.files ?? [],
    challenges: options.challenges ?? [],
    fixes: options.fixes ?? [],
  };
  await appendFile(path, `${JSON.stringify(record)}\n`);
  return { saved: true, path: rel(options.repo, path), id, status, summary: options.summary };
}

function operationId(prefix: "handoff" | "failure", timestamp: string): string {
  return `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}`;
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

function shouldSelectWorkspace(config: WorkspaceConfig, workspace: string | undefined, paths: string[]): boolean {
  return config.enabled || workspace !== undefined || paths.length > 0;
}

function applyWorkspaceRouteBoost(route: RouteMatch, scope: ReturnType<typeof workspaceRouteScope>, decision: WorkspaceDecision | undefined): RouteMatch {
  if (decision?.status !== "selected" || !decision.workspace) return route;
  const boost = workspaceRouteBoost(route.slug, scope);
  if (boost.role === "primary") {
    return {
      ...route,
      score: route.score + boost.score,
      reason: route.score > 0 ? `${route.reason}; workspace ${decision.workspace}` : `workspace ${decision.workspace}`,
    };
  }
  if (boost.role === "dependency") {
    return {
      ...route,
      score: route.score + boost.score,
      reason: route.score > 0 ? `${route.reason}; dependency of ${decision.workspace}` : `dependency of ${decision.workspace}`,
    };
  }
  return route;
}

function applyWorkspaceResultBoost(route: string, score: number, scope: ReturnType<typeof workspaceRouteScope>): number {
  return score + workspaceRouteBoost(route, scope).score;
}

function resumeFirstAction(selected: string[], decision: WorkspaceDecision | undefined): string {
  if (selected.length === 0) return "load docs/context/INDEX.md and identify the smallest relevant context pack";
  if (decision?.status === "selected" && decision.workspace) {
    return `load ${decision.workspace} workspace context (${selected.join(", ")})`;
  }
  return `load ${selected.join(", ")} context packs`;
}

function resumeEditScope(selected: string[], config: WorkspaceConfig, decision: WorkspaceDecision | undefined): string[] {
  return [
    ...workspaceEditScopes(config, decision),
    ...selected.map((slug) => `docs/context/features/${slug}/**`),
  ];
}

function withWorkspaceDecision<T extends object>(value: T, decision: WorkspaceDecision | undefined): T {
  if (decision === undefined) return value;
  return { ...value, workspace_decision: decision };
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
