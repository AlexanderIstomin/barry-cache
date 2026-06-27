import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { exists } from "../src/core/fs";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function runCli(repo: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([process.execPath, cliPath, ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { stdout, stderr, code };
}

async function addPack(repo: string): Promise<void> {
  const dir = join(repo, "docs/context/features/demo");
  await mkdir(dir, { recursive: true });
  await write(join(dir, "README.md"), "# Demo\n\nDemo summary with enough prose to save tokens.\n");
  await write(join(dir, "IDMAP.md"), "# ID Map\n- `X1`: src/demo.ts\n");
  await write(join(dir, "KG.adj"), "demo owns stats\n");
  const rows = Array.from({ length: 6 }, (_, index) => JSON.stringify({
    id: `D${index}`,
    subject: "demo",
    predicate: "tracks",
    object: `token savings detail ${index}`,
    src: ["X1"],
    status: "active",
    kind: "implemented",
    updated_at: "2026-06-20T00:00:00.000Z",
  }));
  await write(join(dir, "FACTS.jsonl"), `${rows.join("\n")}\n`);
}

describe("stats cli", () => {
  test("budgeted load records one compact stats event", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);

      const load = await runCli(repo, ["load", "--route", "demo", "--budget", "400"]);
      expect(load.code).toBe(0);
      expect(load.stderr).toBe("");

      const events = await readEvents(repo);
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event).toEqual(expect.objectContaining({
        schema_version: 1,
        command: "load",
        routes: ["demo"],
        counter: "heuristic",
      }));
      expect(event.saved_tokens).toBeGreaterThan(0);
      expect(event.task).toBeUndefined();
    });
  });

  test("budgeted load still prints output when stats cannot be written", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      await rm(join(repo, ".context-state/stats"), { recursive: true, force: true });
      await writeFile(join(repo, ".context-state/stats"), "not a directory");

      const load = await runCli(repo, ["load", "--route", "demo", "--budget", "400", "--json"]);

      expect(load.code).toBe(0);
      expect(load.stderr).toContain("warning: could not record stats event");
      const parsed = JSON.parse(load.stdout);
      expect(parsed.feature.slug).toBe("demo");
      expect(parsed.budget.used).toBeGreaterThan(0);
    });
  });

  test("budgeted resume records its preview route", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);

      const resume = await runCli(repo, ["resume", "--task", "track token savings"]);
      expect(resume.code).toBe(0);
      expect(resume.stderr).toBe("");

      const events = await readEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({
        command: "resume",
        routes: ["demo"],
      }));
    });
  });

  test("load expand all returns the full pack without recording budget stats", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);

      const load = await runCli(repo, ["load", "--route", "demo", "--expand", "all"]);
      expect(load.code).toBe(0);
      expect(load.stderr).toBe("");
      expect(await exists(join(repo, ".context-state/stats/events.jsonl"))).toBe(false);
    });
  });

  test("stats reports aggregate estimated savings in plain text and JSON", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      await runCli(repo, ["load", "--route", "demo", "--budget", "400"]);
      await runCli(repo, ["resume", "--task", "track token savings"]);

      const plain = await runCli(repo, ["stats"]);
      expect(plain.code).toBe(0);
      expect(plain.stderr).toBe("");
      expect(plain.stdout).toContain("Barry token savings (estimated, heuristic)");
      expect(plain.stdout).toContain("Events: 2");
      expect(plain.stdout).toContain("Estimated tokens saved:");

      const json = await runCli(repo, ["stats", "--json"]);
      expect(json.code).toBe(0);
      const summary = JSON.parse(json.stdout);
      expect(summary.event_count).toBe(2);
      expect(summary.saved_tokens).toBeGreaterThan(0);
      expect(summary.saved_pct).toBeGreaterThan(0);
    });
  });

  test("stats summary remains an alias for the default stats report", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      await runCli(repo, ["load", "--route", "demo", "--budget", "400"]);

      const alias = await runCli(repo, ["stats", "summary", "--json"]);
      expect(alias.code).toBe(0);
      expect(JSON.parse(alias.stdout).event_count).toBe(1);
    });
  });

  test("stats rejects unsupported since values with usage", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });

      const result = await runCli(repo, ["stats", "--since", "yesterday"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unsupported --since value");
      expect(result.stderr).toContain("barry-cache stats");
    });
  });
});

async function readEvents(repo: string): Promise<Array<Record<string, any>>> {
  const text = await readFile(join(repo, ".context-state/stats/events.jsonl"), "utf8");
  return text.trim().split(/\r?\n/).map((row) => JSON.parse(row));
}

async function write(path: string, content: string): Promise<void> {
  await Bun.write(path, content);
}
