import { dirname } from "node:path";
import { exists, readText, repoPath } from "./fs";
import { tokens } from "./text";
import type { CommandIssue } from "./types";

export const WORKSPACE_PRIMARY_BOOST = 100;
export const WORKSPACE_DEPENDENCY_BOOST = 50;
export const workspaceSelectionModes = ["off", "hint", "require-when-ambiguous", "require"] as const;
export type WorkspaceSelectionMode = typeof workspaceSelectionModes[number];
export type WorkspaceDecisionStatus = "disabled" | "none" | "selected" | "ambiguous";
export type WorkspaceDecisionSource = "none" | "explicit" | "path" | "task";

export interface WorkspaceRecord {
  slug: string;
  title: string;
  aliases: string[];
  paths: string[];
  routes: string[];
  depends_on: string[];
}

export interface WorkspaceConfig {
  enabled: boolean;
  path: string;
  selection: {
    mode: WorkspaceSelectionMode;
  };
  workspaces: WorkspaceRecord[];
}

export interface WorkspaceSelectionOptions {
  task: string;
  paths: string[];
  explicitWorkspace?: string;
}

export interface WorkspaceDecision {
  status: WorkspaceDecisionStatus;
  source: WorkspaceDecisionSource;
  evidence: string[];
  workspace?: string;
  candidates?: string[];
  dependencies?: string[];
  required_action?: string;
}

export interface WorkspaceRouteScope {
  primary: string[];
  dependencies: string[];
}

export interface WorkspaceRouteBoost {
  score: number;
  role: "primary" | "dependency" | null;
}

const workspaceConfigPath = "docs/context/workspaces.json";
const defaultSelectionMode: WorkspaceSelectionMode = "require-when-ambiguous";

export async function readWorkspaceConfig(repo: string): Promise<WorkspaceConfig> {
  const path = repoPath(repo, workspaceConfigPath);
  if (!(await exists(path))) {
    return {
      enabled: false,
      path: workspaceConfigPath,
      selection: { mode: "off" },
      workspaces: [],
    };
  }
  const parsed = JSON.parse(await readText(path)) as unknown;
  return normalizeWorkspaceConfig(parsed, true);
}

export function selectWorkspace(config: WorkspaceConfig, options: WorkspaceSelectionOptions): WorkspaceDecision {
  if (!config.enabled || config.selection.mode === "off") {
    const evidence = config.enabled
      ? "workspace selection disabled by docs/context/workspaces.json"
      : `${workspaceConfigPath} not found`;
    return {
      status: "disabled",
      source: "none",
      evidence: [evidence],
    };
  }

  if (options.explicitWorkspace) {
    const workspace = workspaceBySlug(config, options.explicitWorkspace);
    if (!workspace) throw new Error(`Unknown workspace: ${options.explicitWorkspace}`);
    return selectedDecision(workspace, config, "explicit", [`--workspace ${workspace.slug}`]);
  }

  const pathMatches = new Map<string, string[]>();
  for (const path of options.paths.map(normalizePath).filter(Boolean)) {
    for (const workspace of config.workspaces) {
      for (const pattern of workspace.paths) {
        if (!pathMatchesWorkspacePattern(pattern, path)) continue;
        const existing = pathMatches.get(workspace.slug) ?? [];
        existing.push(`${pattern} matched ${path}`);
        pathMatches.set(workspace.slug, existing);
      }
    }
  }
  const pathCandidates = [...pathMatches.keys()].sort();
  if (pathCandidates.length === 1) {
    const workspace = workspaceBySlug(config, pathCandidates[0]!);
    if (workspace) return selectedDecision(workspace, config, "path", pathMatches.get(workspace.slug) ?? []);
  }
  if (pathCandidates.length > 1) return ambiguousDecision("path", pathCandidates, pathCandidates.flatMap((slug) => pathMatches.get(slug) ?? []));

  const taskScores = scoreWorkspaces(config, options.task);
  if (taskScores.length === 0) {
    if (config.selection.mode === "require") {
      return {
        status: "none",
        source: "none",
        evidence: ["workspace is required but no workspace matched task text or paths"],
        required_action: "rerun with --workspace <slug> or ask the user",
      };
    }
    return { status: "none", source: "none", evidence: ["no workspace matched task text or paths"] };
  }

  const topScore = taskScores[0]!.score;
  const top = taskScores.filter((item) => item.score === topScore).map((item) => item.workspace.slug).sort();
  if (top.length > 1) {
    if (config.selection.mode === "hint") {
      const first = workspaceBySlug(config, top[0]!);
      if (first) return selectedDecision(first, config, "task", [`ambiguous task match; hint mode selected ${first.slug}`]);
    }
    return ambiguousDecision("task", top, taskScores.filter((item) => top.includes(item.workspace.slug)).map((item) => item.evidence));
  }

  const workspace = workspaceBySlug(config, top[0]!);
  if (!workspace) return { status: "none", source: "none", evidence: ["no workspace matched task text or paths"] };
  const scored = taskScores.find((item) => item.workspace.slug === workspace.slug);
  return selectedDecision(workspace, config, "task", scored ? [scored.evidence] : [`task matched ${workspace.slug}`]);
}

export function workspaceSelectionOptions(task: string, paths: string[], explicitWorkspace: string | undefined): WorkspaceSelectionOptions {
  const options: WorkspaceSelectionOptions = { task, paths };
  if (explicitWorkspace !== undefined) options.explicitWorkspace = explicitWorkspace;
  return options;
}

export function workspaceRouteScope(config: WorkspaceConfig, decision: WorkspaceDecision | undefined): WorkspaceRouteScope {
  if (decision?.status !== "selected" || !decision.workspace) return { primary: [], dependencies: [] };
  const workspace = workspaceBySlug(config, decision.workspace);
  if (!workspace) return { primary: [], dependencies: [] };
  const dependencyRoutes = (decision.dependencies ?? [])
    .flatMap((slug) => workspaceBySlug(config, slug)?.routes ?? []);
  return {
    primary: [...workspace.routes].sort(),
    dependencies: uniqueSorted(dependencyRoutes),
  };
}

export function workspaceEditScopes(config: WorkspaceConfig, decision: WorkspaceDecision | undefined): string[] {
  if (decision?.status !== "selected" || !decision.workspace) return [];
  const workspace = workspaceBySlug(config, decision.workspace);
  if (!workspace) return [];
  return [...workspace.paths].sort();
}

export function workspaceRouteBoost(route: string, scope: WorkspaceRouteScope): WorkspaceRouteBoost {
  if (scope.primary.includes(route)) return { score: WORKSPACE_PRIMARY_BOOST, role: "primary" };
  if (scope.dependencies.includes(route)) return { score: WORKSPACE_DEPENDENCY_BOOST, role: "dependency" };
  return { score: 0, role: null };
}

export async function validateWorkspaceConfig(repo: string, featureSlugs: string[]): Promise<{ errors: CommandIssue[]; warnings: CommandIssue[] }> {
  const path = repoPath(repo, workspaceConfigPath);
  if (!(await exists(path))) return { errors: [], warnings: [] };

  const errors: CommandIssue[] = [];
  const warnings: CommandIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(path)) as unknown;
  } catch {
    return { errors: [{ file: workspaceConfigPath, message: "invalid JSON" }], warnings };
  }

  const normalized = normalizeWorkspaceConfig(parsed, false);
  const raw = isObject(parsed) ? parsed : {};
  if (!isObject(parsed)) errors.push({ file: workspaceConfigPath, message: "workspace registry must be an object" });
  if ((raw as { version?: unknown }).version !== 1) errors.push({ file: workspaceConfigPath, message: "workspace registry version must be 1" });

  const mode = isObject((raw as { selection?: unknown }).selection) ? ((raw as { selection: Record<string, unknown> }).selection.mode) : undefined;
  if (mode !== undefined && (typeof mode !== "string" || !workspaceSelectionModes.includes(mode as WorkspaceSelectionMode))) {
    errors.push({ file: workspaceConfigPath, message: `invalid workspace selection mode: ${String(mode)}` });
  }

  const seenSlugs = new Set<string>();
  const allSlugs = new Set(normalized.workspaces.map((workspace) => workspace.slug));
  const routes = new Set(featureSlugs);
  for (const workspace of normalized.workspaces) {
    if (seenSlugs.has(workspace.slug)) errors.push({ file: workspaceConfigPath, message: `duplicate workspace slug: ${workspace.slug}` });
    seenSlugs.add(workspace.slug);

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace.slug)) {
      errors.push({ file: workspaceConfigPath, message: `invalid workspace slug: ${workspace.slug}` });
    }
    if (workspace.title.trim().length === 0) errors.push({ file: workspaceConfigPath, message: `workspace ${workspace.slug} title is required` });

    const seenAliases = new Set<string>();
    for (const alias of workspace.aliases) {
      const key = alias.toLowerCase();
      if (seenAliases.has(key)) errors.push({ file: workspaceConfigPath, message: `workspace ${workspace.slug} has duplicate alias: ${alias}` });
      seenAliases.add(key);
    }

    for (const route of workspace.routes) {
      if (!routes.has(route)) errors.push({ file: workspaceConfigPath, message: `workspace ${workspace.slug} references unknown route: ${route}` });
    }
    for (const dependency of workspace.depends_on) {
      if (!allSlugs.has(dependency)) errors.push({ file: workspaceConfigPath, message: `workspace ${workspace.slug} depends on unknown workspace: ${dependency}` });
      if (dependency === workspace.slug) errors.push({ file: workspaceConfigPath, message: `workspace ${workspace.slug} cannot depend on itself` });
    }
    for (const pattern of workspace.paths) {
      if (!(await workspacePatternExists(repo, pattern))) {
        warnings.push({ file: workspaceConfigPath, message: `workspace ${workspace.slug} path matched no files: ${pattern}` });
      }
    }
  }

  return { errors, warnings };
}

export function pathMatchesWorkspacePattern(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    if (prefix.includes("*")) {
      return new RegExp(`^${wildcardRegexSource(prefix)}(?:/.*)?$`).test(normalizedPath);
    }
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (!normalizedPattern.includes("*")) return normalizedPattern === normalizedPath;
  const regex = new RegExp(`^${wildcardRegexSource(normalizedPattern)}$`);
  return regex.test(normalizedPath);
}

function normalizeWorkspaceConfig(value: unknown, strict: boolean): WorkspaceConfig {
  if (!isObject(value)) {
    if (strict) throw new Error("workspace registry must be an object");
    return { enabled: true, path: workspaceConfigPath, selection: { mode: defaultSelectionMode }, workspaces: [] };
  }
  const modeValue = isObject(value.selection) ? value.selection.mode : undefined;
  const mode = typeof modeValue === "string" && workspaceSelectionModes.includes(modeValue as WorkspaceSelectionMode)
    ? modeValue as WorkspaceSelectionMode
    : defaultSelectionMode;
  const rawWorkspaces = Array.isArray(value.workspaces) ? value.workspaces : [];
  return {
    enabled: true,
    path: workspaceConfigPath,
    selection: { mode },
    workspaces: rawWorkspaces.filter(isObject).map(normalizeWorkspaceRecord),
  };
}

function normalizeWorkspaceRecord(value: Record<string, unknown>): WorkspaceRecord {
  return {
    slug: typeof value.slug === "string" ? value.slug : "",
    title: typeof value.title === "string" ? value.title : "",
    aliases: stringArray(value.aliases),
    paths: stringArray(value.paths),
    routes: stringArray(value.routes),
    depends_on: stringArray(value.depends_on),
  };
}

function selectedDecision(workspace: WorkspaceRecord, config: WorkspaceConfig, source: WorkspaceDecisionSource, evidence: string[]): WorkspaceDecision {
  const dependencies = knownDependencies(config, workspace);
  const decision: WorkspaceDecision = {
    status: "selected",
    source,
    workspace: workspace.slug,
    evidence,
  };
  if (dependencies.length > 0) decision.dependencies = dependencies;
  return decision;
}

function ambiguousDecision(source: WorkspaceDecisionSource, candidates: string[], evidence: string[]): WorkspaceDecision {
  return {
    status: "ambiguous",
    source,
    candidates: [...candidates].sort(),
    evidence,
    required_action: "rerun with --workspace <slug> or ask the user",
  };
}

function workspaceBySlug(config: WorkspaceConfig, slug: string): WorkspaceRecord | undefined {
  return config.workspaces.find((workspace) => workspace.slug === slug);
}

function knownDependencies(config: WorkspaceConfig, workspace: WorkspaceRecord): string[] {
  const slugs = new Set(config.workspaces.map((item) => item.slug));
  return workspace.depends_on.filter((slug) => slugs.has(slug)).sort();
}

function scoreWorkspaces(config: WorkspaceConfig, task: string): Array<{ workspace: WorkspaceRecord; score: number; evidence: string }> {
  const taskTokens = tokens(task);
  if (taskTokens.length === 0) return [];
  return config.workspaces
    .map((workspace) => {
      const terms = workspaceTerms(workspace);
      const matched = taskTokens.filter((token) => terms.some((term) => term.includes(token) || token.includes(term)));
      return {
        workspace,
        score: matched.length,
        evidence: matched.length > 0 ? `task matched ${workspace.slug}: ${matched.join(", ")}` : "",
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.workspace.slug.localeCompare(b.workspace.slug));
}

function workspaceTerms(workspace: WorkspaceRecord): string[] {
  return [
    workspace.slug,
    workspace.title,
    ...workspace.aliases,
    ...workspace.routes,
    ...workspace.paths,
  ].flatMap(tokens);
}

async function workspacePatternExists(repo: string, pattern: string): Promise<boolean> {
  const normalized = normalizePath(pattern);
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3);
    if (!prefix.includes("*")) return await exists(repoPath(repo, prefix));
    const stablePrefix = prefix.split("*")[0] ?? "";
    const base = stablePrefix.endsWith("/") ? stablePrefix.slice(0, -1) : dirname(stablePrefix);
    return base.length === 0 || base === "." ? true : await exists(repoPath(repo, base));
  }
  if (!normalized.includes("*")) return await exists(repoPath(repo, normalized));
  const prefix = normalized.split("*")[0] ?? "";
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : dirname(prefix);
  return base.length === 0 || base === "." ? true : await exists(repoPath(repo, base));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wildcardRegexSource(pattern: string): string {
  return escapeRegex(pattern).replace(/\\\*/g, "[^/]*");
}
