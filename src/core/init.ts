import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { applyManagedBlock, conceptOverviewMd, factSchema, failureSchema, indexMd, logMd, maintenanceMd, readmeMd, routeSchema, strategySchema, workStateSchema, agentInstructions } from "./templates";
import { exists, readText, repoPath, writeIfChanged, writeText } from "./fs";
import type { InitResult } from "./types";

export interface InitOptions {
  repo: string;
  yes?: boolean;
  dryRun?: boolean;
}

interface PlannedFile {
  path: string;
  content: string;
}

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
    { path: ".cursor/rules/barry-cache.mdc", content: adapterFile("Cursor") },
    { path: ".github/copilot-instructions.md", content: adapterFile("GitHub Copilot") },
    { path: "CLAUDE.md", content: adapterFile("Claude Code") },
    { path: "GEMINI.md", content: adapterFile("Gemini") },
    { path: "llms.txt", content: llmsTxt() },
  ];

  for (const file of files) {
    const status = await writeIfChanged(repoPath(repo, file.path), file.content, dryRun);
    record(result, status, file.path);
  }

  await patchAgents(repo, dryRun, result);
  await patchGitignore(repo, dryRun, result);
  await patchPackageJson(repo, dryRun, result);

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

async function patchAgents(repo: string, dryRun: boolean, result: InitResult): Promise<void> {
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

async function patchPackageJson(repo: string, dryRun: boolean, result: InitResult): Promise<void> {
  const path = repoPath(repo, "package.json");
  if (!(await exists(path))) return;

  const parsed = JSON.parse(await readText(path)) as Record<string, unknown>;
  const scripts = typeof parsed.scripts === "object" && parsed.scripts !== null ? parsed.scripts as Record<string, string> : {};
  scripts.context ??= "barry-cache";
  scripts["context:validate"] ??= "barry-cache validate";
  scripts["context:resume"] ??= "barry-cache resume";
  scripts["context:finalize"] ??= "barry-cache finalize";
  parsed.scripts = scripts;

  const devDependencies = typeof parsed.devDependencies === "object" && parsed.devDependencies !== null ? parsed.devDependencies as Record<string, string> : {};
  devDependencies["barry-cache"] ??= "^0.1.0";
  parsed.devDependencies = devDependencies;

  record(result, await writeIfChanged(path, `${JSON.stringify(parsed, null, 2)}\n`, dryRun), "package.json");
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
