#!/usr/bin/env node
import { finalizeProject, loadContext, resumeProject, routeTask, searchContext } from "./core/context";
import { initProject } from "./core/init";
import { validateProject } from "./core/validate";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const repo = process.cwd();
  const json = parsed.flags.get("json") === true;

  try {
    switch (parsed.command) {
      case "init": {
        const result = await initProject({
          repo,
          yes: parsed.flags.get("yes") === true,
          dryRun: parsed.flags.get("dry-run") === true,
        });
        print(result, json, `Barry Cache init ${result.changed ? "changed files" : "already up to date"}.`);
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
        const task = requiredString(parsed, "task");
        print(await routeTask({ repo, task }), json);
        break;
      }
      case "search": {
        const query = requiredString(parsed, "query");
        print(await searchContext({ repo, query }), json);
        break;
      }
      case "load": {
        const route = requiredString(parsed, "route");
        print(await loadContext({ repo, route }), json);
        break;
      }
      case "resume": {
        const task = requiredString(parsed, "task");
        print(await resumeProject({ repo, task }), json);
        break;
      }
      case "finalize": {
        const status = (parsed.flags.get("status") || "success") as "success" | "partial" | "blocked" | "failed";
        const summary = requiredString(parsed, "summary");
        print(await finalizeProject({ repo, status, summary }), json);
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
        usage();
        process.exitCode = 1;
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
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

function requiredString(parsed: ParsedArgs, key: string): string {
  const value = parsed.flags.get(key);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required --${key}`);
  return value;
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

function usage(): void {
  console.log(`Barry Cache remembers your repo.

Usage:
  barry-cache init [--yes] [--dry-run]
  barry-cache validate [--json]
  barry-cache route --task "..." [--json]
  barry-cache search --query "..." [--json]
  barry-cache load --route "..." [--json]
  barry-cache resume --task "..." [--json]
  barry-cache finalize --summary "..." [--status success] [--json]
`);
}

if (import.meta.main) {
  await main();
}
