import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { applyManagedBlock, conceptOverviewMd, factSchema, failureSchema, indexMd, logMd, maintenanceMd, readmeMd, routeSchema, strategySchema, workStateSchema, agentInstructions } from "./templates";
import { exists, readText, repoPath, writeIfChanged, writeText } from "./fs";
import type { AgentInstructionTarget, InitResult, PackageManagerHint } from "./types";

export interface InitOptions {
  repo: string;
  yes?: boolean;
  dryRun?: boolean;
  agents?: AgentInstructionTarget[];
}

interface PlannedFile {
  path: string;
  content: string;
}

const allAgentTargets: AgentInstructionTarget[] = ["codex", "cursor", "copilot", "claude", "gemini", "llms"];

const adapterFiles: Array<{ target: Exclude<AgentInstructionTarget, "codex">; path: string; content: string }> = [
  { target: "cursor", path: ".cursor/rules/barry-cache.mdc", content: adapterFile("Cursor") },
  { target: "copilot", path: ".github/copilot-instructions.md", content: adapterFile("GitHub Copilot") },
  { target: "claude", path: "CLAUDE.md", content: adapterFile("Claude Code") },
  { target: "gemini", path: "GEMINI.md", content: adapterFile("Gemini") },
  { target: "llms", path: "llms.txt", content: llmsTxt() },
];

export async function initProject(options: InitOptions): Promise<InitResult> {
  const repo = options.repo;
  const dryRun = options.dryRun ?? false;
  const result: InitResult = { changed: false, written: [], updated: [], skipped: [], dryRun };

  const files: PlannedFile[] = [
    { path: "docs/context/README.md", content: readmeMd },
    { path: "docs/context/INDEX.md", content: indexMd },
    { path: "docs/context/LOG.md", content: logMd },
    { path: "docs/context/MAINTENANCE.md", content: maintenanceMd },
    { path: "docs/context/concepts/project-context-model.md", content: conceptOverviewMd },
    { path: "docs/context/schema/fact.schema.json", content: `${JSON.stringify(factSchema, null, 2)}\n` },
    { path: "docs/context/schema/route.schema.json", content: `${JSON.stringify(routeSchema, null, 2)}\n` },
    { path: "docs/context/schema/work-state.schema.json", content: `${JSON.stringify(workStateSchema, null, 2)}\n` },
    { path: "docs/context/schema/strategy.schema.json", content: `${JSON.stringify(strategySchema, null, 2)}\n` },
    { path: "docs/context/schema/failure.schema.json", content: `${JSON.stringify(failureSchema, null, 2)}\n` },
  ];

  for (const file of files) {
    const status = await writeIfChanged(repoPath(repo, file.path), file.content, dryRun);
    record(result, status, file.path);
  }

  await patchAgentInstructions(repo, dryRun, result, options.agents);
  await patchGitignore(repo, dryRun, result);
  const packageManager = await patchPackageJson(repo, dryRun, result);
  if (packageManager) result.packageManager = packageManager;

  if (!dryRun) {
    await mkdir(join(repo, ".context-state/work/threads"), { recursive: true });
    await mkdir(join(repo, ".context-state/handoffs"), { recursive: true });
    await mkdir(join(repo, ".context-state/failures"), { recursive: true });
    await mkdir(join(repo, ".context-state/strategies"), { recursive: true });
    await mkdir(join(repo, ".context-cache"), { recursive: true });
  }

  result.changed = result.written.length > 0 || result.updated.length > 0;
  return result;
}

function record(result: InitResult, status: "written" | "updated" | "skipped", path: string): void {
  if (status === "written") result.written.push(path);
  if (status === "updated") result.updated.push(path);
  if (status === "skipped") result.skipped.push(path);
}

async function patchAgentInstructions(repo: string, dryRun: boolean, result: InitResult, agents: AgentInstructionTarget[] | undefined): Promise<void> {
  const selected = new Set(agents ?? allAgentTargets);
  if (selected.has("codex")) await patchCodexAgents(repo, dryRun, result);
  for (const file of adapterFiles) {
    if (!selected.has(file.target)) continue;
    record(result, await writeIfChanged(repoPath(repo, file.path), file.content, dryRun), file.path);
  }
}

async function patchCodexAgents(repo: string, dryRun: boolean, result: InitResult): Promise<void> {
  const path = repoPath(repo, "AGENTS.md");
  const existing = (await exists(path)) ? await readText(path) : "";
  const content = applyManagedBlock(existing, agentInstructions);
  record(result, await writeIfChanged(path, content, dryRun), "AGENTS.md");
}

async function patchGitignore(repo: string, dryRun: boolean, result: InitResult): Promise<void> {
  const path = repoPath(repo, ".gitignore");
  const existing = (await exists(path)) ? await readText(path) : "";
  const body = ".context-state/\n.context-cache/\n";
  const content = applyManagedBlock(existing, body);
  record(result, await writeIfChanged(path, content, dryRun), ".gitignore");
}

async function patchPackageJson(repo: string, dryRun: boolean, result: InitResult): Promise<PackageManagerHint | undefined> {
  const path = repoPath(repo, "package.json");
  if (!(await exists(path))) return undefined;

  const parsed = JSON.parse(await readText(path)) as Record<string, unknown>;
  const scripts = typeof parsed.scripts === "object" && parsed.scripts !== null ? parsed.scripts as Record<string, string> : {};
  scripts.barry ??= "barry-cache";
  scripts["barry:validate"] ??= "barry-cache validate";
  scripts["barry:resume"] ??= "barry-cache resume";
  scripts["barry:finalize"] ??= "barry-cache finalize";
  parsed.scripts = scripts;

  const devDependencies = typeof parsed.devDependencies === "object" && parsed.devDependencies !== null ? parsed.devDependencies as Record<string, string> : {};
  devDependencies["barry-cache"] ??= "^0.1.0";
  parsed.devDependencies = devDependencies;

  record(result, await writeIfChanged(path, `${JSON.stringify(parsed, null, 2)}\n`, dryRun), "package.json");
  return await detectPackageManager(repo, parsed);
}

async function detectPackageManager(repo: string, packageJson: Record<string, unknown>): Promise<PackageManagerHint> {
  const packageManager = typeof packageJson.packageManager === "string" ? packageJson.packageManager.split("@")[0] : "";
  if (packageManager === "bun" || packageManager === "pnpm" || packageManager === "yarn" || packageManager === "npm") {
    return packageManagerHint(packageManager);
  }

  if (await exists(repoPath(repo, "bun.lock")) || await exists(repoPath(repo, "bun.lockb"))) return packageManagerHint("bun");
  if (await exists(repoPath(repo, "pnpm-lock.yaml"))) return packageManagerHint("pnpm");
  if (await exists(repoPath(repo, "yarn.lock"))) return packageManagerHint("yarn");
  if (await exists(repoPath(repo, "package-lock.json")) || await exists(repoPath(repo, "npm-shrinkwrap.json"))) return packageManagerHint("npm");
  return packageManagerHint("npm");
}

function packageManagerHint(name: PackageManagerHint["name"]): PackageManagerHint {
  return {
    name,
    installCommand: `${name} install`,
  };
}

function adapterFile(agent: string): string {
  return `# Barry Cache for ${agent}

Canonical context lives in \`docs/context/\`.

Start by running:

\`\`\`bash
barry-cache resume --task "<task>"
\`\`\`

Validate context changes with:

\`\`\`bash
barry-cache validate
\`\`\`
`;
}

function llmsTxt(): string {
  return `# Barry Cache

## Context

- [Context index](docs/context/INDEX.md)
- [Maintenance](docs/context/MAINTENANCE.md)
- [Project model](docs/context/concepts/project-context-model.md)
`;
}
