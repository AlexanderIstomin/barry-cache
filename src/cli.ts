#!/usr/bin/env node
import { finalizeProject, loadContext, resumeProject, routeTask, searchContext } from "./core/context";
import { importPulpcutKb } from "./core/import-pulpcut";
import { initProject } from "./core/init";
import { buildReviewModel } from "./core/review-model";
import { startReviewServer } from "./core/review-server";
import type { AgentInstructionTarget, InitResult } from "./core/types";
import { validateProject } from "./core/validate";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
}

interface CliArgumentErrorDetails {
  usage?: string | undefined;
  options?: Record<string, string[]> | undefined;
}

class CliArgumentError extends Error {
  usage: string | undefined;
  options: Record<string, string[]> | undefined;

  constructor(message: string, details: CliArgumentErrorDetails = {}) {
    super(message);
    this.name = "CliArgumentError";
    this.usage = details.usage;
    this.options = details.options;
  }
}

const importSources = ["pulpcut-kb"] as const;
const agentTargets = ["all", "none", "codex", "cursor", "copilot", "claude", "gemini", "llms"];
const finalizeStatuses = ["success", "partial", "blocked", "failed"] as const;

async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const repo = process.cwd();
  const json = parsed.flags.get("json") === true;

  try {
    switch (parsed.command) {
      case "init": {
        const agents = parseAgentTargets(parsed.flags.get("agents") ?? parsed.flags.get("agent"));
        const initOptions: Parameters<typeof initProject>[0] = {
          repo,
          yes: parsed.flags.get("yes") === true,
          dryRun: parsed.flags.get("dry-run") === true,
        };
        if (agents !== undefined) initOptions.agents = agents;
        const result = await initProject(initOptions);
        print(result, json, formatInitMessage(result));
        break;
      }
      case "validate": {
        const result = await validateProject({ repo });
        print(result, json, result.ok ? "Barry Cache context is valid." : `Barry Cache found ${result.errors.length} error(s).`);
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case "routes":
        print(await routeTask({ repo, task: "" }), json);
        break;
      case "route": {
        const task = requiredString(parsed, "task", commandUsage("route"));
        print(await routeTask({ repo, task }), json);
        break;
      }
      case "search": {
        const query = requiredString(parsed, "query", commandUsage("search"));
        print(await searchContext({ repo, query }), json);
        break;
      }
      case "load": {
        const route = requiredString(parsed, "route", commandUsage("load"));
        print(await loadContext({ repo, route }), json);
        break;
      }
      case "resume": {
        const task = requiredString(parsed, "task", commandUsage("resume"));
        print(await resumeProject({ repo, task }), json);
        break;
      }
      case "finalize": {
        const status = optionalChoice(parsed, "status", finalizeStatuses, "success", commandUsage("finalize"));
        const summary = requiredString(parsed, "summary", commandUsage("finalize"), { status: [...finalizeStatuses] });
        print(await finalizeProject({ repo, status, summary }), json);
        break;
      }
      case "import": {
        const source = requiredString(parsed, "source", commandUsage("import"), { source: [...importSources] });
        const from = requiredString(parsed, "from", commandUsage("import"), { source: [...importSources] });
        if (!isImportSource(source)) {
          throw new CliArgumentError(`Unsupported import source: ${source}`, {
            usage: commandUsage("import"),
            options: { source: [...importSources] },
          });
        }
        const result = await importPulpcutKb({
          repo,
          from,
          dryRun: parsed.flags.get("dry-run") === true,
        });
        print(result, json, `Imported ${result.imported} PulpCut KB feature pack${result.imported === 1 ? "" : "s"}.`);
        break;
      }
      case "review": {
        if (json) {
          print(await buildReviewModel({ repo }), true);
          break;
        }
        const server = await startReviewServer({
          repo,
          port: optionalNumber(parsed, "port", 8787, commandUsage("review")),
          open: parsed.flags.get("open") === true,
        });
        console.log(`Barry Cache review running at ${server.url}`);
        console.log("Press Ctrl+C to stop.");
        process.once("SIGINT", async () => {
          await server.close();
          process.exit(0);
        });
        process.once("SIGTERM", async () => {
          await server.close();
          process.exit(0);
        });
        break;
      }
      case "doctor": {
        const result = await validateProject({ repo });
        print(result, json, result.ok ? "Barry Cache setup looks healthy." : "Barry Cache setup needs attention.");
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case "generate-adapters":
        print({ ok: true, message: "Run barry-cache init to regenerate adapters." }, json);
        break;
      case "lint-wiki":
        print({ ok: true, message: "No wiki lint rules failed." }, json);
        break;
      default:
        if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
          console.log(usageText());
        } else {
          console.error(usageText(`Unknown command: ${parsed.command}`));
          process.exitCode = 1;
        }
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify(formatJsonError(error), null, 2));
    } else {
      console.error(formatCliError(error));
    }
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else {
      flags.set(key, true);
    }
  }
  return { command, flags };
}

function requiredString(parsed: ParsedArgs, key: string, usageValue?: string, options?: Record<string, string[]>): string {
  const value = parsed.flags.get(key);
  if (value === true) throw new CliArgumentError(`--${key} requires a value`, { usage: usageValue, options });
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`Missing required --${key}`, { usage: usageValue, options });
  return value;
}

function optionalNumber(parsed: ParsedArgs, key: string, fallback: number, usageValue?: string): number {
  const value = parsed.flags.get(key);
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`--${key} requires a number`, { usage: usageValue });
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 65535) throw new CliArgumentError(`--${key} must be a port number`, { usage: usageValue });
  return parsedValue;
}

function optionalChoice<const T extends readonly string[]>(parsed: ParsedArgs, key: string, choices: T, fallback: T[number], usageValue?: string): T[number] {
  const value = parsed.flags.get(key);
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`--${key} requires a value`, { usage: usageValue, options: { [key]: [...choices] } });
  if (!(choices as readonly string[]).includes(value)) {
    throw new CliArgumentError(`Unsupported --${key} value: ${value}`, {
      usage: usageValue,
      options: { [key]: [...choices] },
    });
  }
  return value as T[number];
}

function parseAgentTargets(value: string | boolean | undefined): AgentInstructionTarget[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CliArgumentError("--agents requires a comma-separated list", { usage: commandUsage("init"), options: { agents: agentTargets } });
  const rawTargets = value.split(",").map((item: string) => item.trim().toLowerCase()).filter(Boolean);
  if (rawTargets.length === 0) throw new CliArgumentError("--agents requires at least one target", { usage: commandUsage("init"), options: { agents: agentTargets } });
  if (rawTargets.includes("all")) {
    if (rawTargets.length > 1) throw new CliArgumentError("--agents all cannot be combined with other targets", { usage: commandUsage("init"), options: { agents: agentTargets } });
    return undefined;
  }
  if (rawTargets.includes("none")) {
    if (rawTargets.length > 1) throw new CliArgumentError("--agents none cannot be combined with other targets", { usage: commandUsage("init"), options: { agents: agentTargets } });
    return [];
  }

  const validTargets = new Set<AgentInstructionTarget>(["codex", "cursor", "copilot", "claude", "gemini", "llms"]);
  const targets: AgentInstructionTarget[] = [];
  for (const target of rawTargets) {
    if (!validTargets.has(target as AgentInstructionTarget)) {
      throw new CliArgumentError(`Unsupported --agents target: ${target}`, { usage: commandUsage("init"), options: { agents: agentTargets } });
    }
    if (!targets.includes(target as AgentInstructionTarget)) targets.push(target as AgentInstructionTarget);
  }
  return targets;
}

function print(value: unknown, json: boolean, message?: string): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (message) {
    console.log(message);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function formatInitMessage(result: InitResult): string {
  if (!result.dryRun) {
    const lines = [`Barry Cache init ${result.changed ? "changed files" : "already up to date"}.`];
    addInstallHint(lines, result, false);
    return lines.join("\n");
  }
  if (!result.changed) {
    const lines = ["Barry Cache init would not change files."];
    addInstallHint(lines, result, true);
    return lines.join("\n");
  }

  const lines = ["Barry Cache init would change files."];
  addPathSection(lines, "Create:", result.written);
  addPathSection(lines, "Update:", result.updated);
  addInstallHint(lines, result, true);
  return `${lines.join("\n")}\n`;
}

function addPathSection(lines: string[], title: string, paths: string[]): void {
  if (paths.length === 0) return;
  lines.push("", title);
  for (const path of paths) lines.push(`  ${path}`);
}

function addInstallHint(lines: string[], result: InitResult, dryRun: boolean): void {
  if (!result.packageManager) return;
  lines.push("", green(`${dryRun ? "After applying, run" : "Run"}: ${result.packageManager.installCommand}`));
}

function green(value: string): string {
  return `\u001b[32m${value}\u001b[0m`;
}

function formatJsonError(error: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = { ok: false, error: errorMessage(error) };
  if (error instanceof CliArgumentError) {
    if (error.usage) payload.usage = error.usage;
    if (error.options) payload.options = error.options;
  }
  return payload;
}

function formatCliError(error: unknown): string {
  if (!(error instanceof CliArgumentError)) return errorMessage(error);
  const lines = [error.message];
  if (error.usage) lines.push("", "Usage:", `  ${error.usage}`);
  if (error.options) {
    for (const [name, values] of Object.entries(error.options)) {
      lines.push("", `Available --${name} values:`);
      for (const value of values) lines.push(`  ${value}`);
    }
  }
  return lines.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandUsage(command: string): string | undefined {
  const usages: Record<string, string> = {
    init: "barry-cache init [--yes] [--dry-run] [--agents all|none|codex,cursor,copilot,claude,gemini,llms]",
    route: 'barry-cache route --task "..." [--json]',
    search: 'barry-cache search --query "..." [--json]',
    load: 'barry-cache load --route "..." [--json]',
    resume: 'barry-cache resume --task "..." [--json]',
    finalize: 'barry-cache finalize --summary "..." [--status success|partial|blocked|failed] [--json]',
    import: "barry-cache import --source pulpcut-kb --from /path/to/repo [--dry-run] [--json]",
    review: "barry-cache review [--port 8787] [--open] [--json]",
  };
  return usages[command];
}

function isImportSource(value: string): value is typeof importSources[number] {
  return (importSources as readonly string[]).includes(value);
}

function usageText(message?: string): string {
  return `${message ? `${message}\n\n` : ""}Barry Cache remembers your repo.

Usage:
  barry-cache init [--yes] [--dry-run] [--agents all|none|codex,cursor,copilot,claude,gemini,llms]
  barry-cache validate [--json]
  barry-cache route --task "..." [--json]
  barry-cache search --query "..." [--json]
  barry-cache load --route "..." [--json]
  barry-cache resume --task "..." [--json]
  barry-cache finalize --summary "..." [--status success] [--json]
  barry-cache import --source pulpcut-kb --from /path/to/repo [--dry-run] [--json]
  barry-cache review [--port 8787] [--open]
  barry-cache review --json
`;
}

if (import.meta.main) {
  await main();
}
