import { createBrain } from "./core/brain";
import { intakeDisabledFromEnv, loadOrInitBrainConfig } from "./core/config";
import { loadOrCreateBrainIdentity } from "./core/identity";
import { createSqliteStore } from "./core/store-sqlite";
import { createRouter } from "./http/router";
import { startBunServer } from "./runtime/bun-server";
import { runConformance } from "./conformance/suite";

export interface BrainCliResult {
  code: number;
  stdout: string;
}

const USAGE = [
  "Usage: barry-brain <command> [options]",
  "",
  "Commands:",
  "  init         Create config + identity in the data dir",
  "  migrate      Create the database schema",
  "  serve        Run the brain server",
  "  conformance  Run the Brain contract checks against --url",
  "",
  "Options:",
  "  --dir <path>            Data dir (default: $BRAIN_DATA_DIR or .brain-data)",
  "  --trust-policy <p>      company | global (init only)",
  "  --port <n>              Listen port (init/serve)",
  "  --url <baseUrl>         Target brain URL (conformance)",
].join("\n");

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

export async function runBrainCli(argv: string[]): Promise<BrainCliResult> {
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));
  const dir = flags.dir ?? process.env.BRAIN_DATA_DIR ?? ".brain-data";
  const trustPolicy = flags["trust-policy"] === "global" ? "global" : flags["trust-policy"] === "company" ? "company" : undefined;
  const port = flags.port ? Number(flags.port) : undefined;

  if (command === "init") {
    const config = await loadOrInitBrainConfig({ dir, trustPolicy, port });
    const identity = await loadOrCreateBrainIdentity({ dir, now: new Date().toISOString() });
    return {
      code: 0,
      stdout: [
        `Brain initialized in ${dir} (trust policy: ${config.trust_policy}).`,
        `Pin this fingerprint in clients: ${identity.fingerprint}`,
      ].join("\n"),
    };
  }

  if (command === "migrate") {
    const config = await loadOrInitBrainConfig({ dir, trustPolicy, port });
    const store = createSqliteStore(config.db_path);
    await store.migrate();
    await store.close();
    return { code: 0, stdout: `Database migrated at ${config.db_path}` };
  }

  if (command === "serve") {
    const config = await loadOrInitBrainConfig({ dir, trustPolicy, port });
    const identity = await loadOrCreateBrainIdentity({ dir, now: new Date().toISOString() });
    const store = createSqliteStore(config.db_path);
    await store.migrate();
    const brain = createBrain({ store, identity, trustPolicy: config.trust_policy, now: () => new Date().toISOString() });
    const router = createRouter({ brain, intakeDisabled: intakeDisabledFromEnv(), fingerprint: identity.fingerprint });
    const server = startBunServer({ router, port: port ?? config.port });
    return { code: 0, stdout: `Brain serving on :${server.port} (fingerprint ${identity.fingerprint})` };
  }

  if (command === "conformance") {
    const baseUrl = flags.url;
    if (!baseUrl || baseUrl === "true") {
      return { code: 1, stdout: "conformance requires --url <baseUrl>" };
    }
    const report = await runConformance({ baseUrl });
    const lines = report.checks.map((c) => `[${c.ok ? "PASS" : "FAIL"}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    lines.push(`${report.passed}/${report.checks.length} checks passed`);
    return { code: report.failed === 0 ? 0 : 1, stdout: lines.join("\n") };
  }

  return { code: 1, stdout: USAGE };
}

if (import.meta.main) {
  runBrainCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${result.stdout}\n`);
    if (result.code !== 0) process.exit(result.code);
  });
}
