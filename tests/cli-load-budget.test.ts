import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
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

async function addPack(repo: string, factCount: number): Promise<void> {
  const dir = join(repo, "docs/context/features/demo");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# Demo\n\nDemo summary.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `X1`: src/demo.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  const rows = Array.from({ length: factCount }, (_, i) =>
    JSON.stringify({
      id: `D${i}`, subject: "S", predicate: "p", object: `object ${i}`,
      src: ["X1"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
    }));
  await writeFile(join(dir, "FACTS.jsonl"), rows.join("\n") + "\n");
}

describe("load budgeting (CLI)", () => {
  test("no --budget returns the full raw pack (backward compatible)", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, 12);
      const result = await runCli(repo, ["load", "--route", "demo"]);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.facts).toHaveLength(12);
      expect(parsed.budget).toBeUndefined();
    });
  });

  test("--budget drops facts, stays within budget, and lists dropped ids", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, 12);
      const result = await runCli(repo, ["load", "--route", "demo", "--budget", "120"]);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.budget.used).toBeLessThanOrEqual(120);
      expect(parsed.facts.length).toBeLessThan(12);
      expect(parsed.budget.dropped.length).toBeGreaterThan(0);
      expect(parsed.budget.expand_hint).toContain("--expand");
    });
  });

  test("--expand all reproduces the full raw pack", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, 12);
      const result = await runCli(repo, ["load", "--route", "demo", "--budget", "120", "--expand", "all"]);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.facts).toHaveLength(12);
      expect(parsed.budget).toBeUndefined();
    });
  });

  test("--expand <id> forces a specific fact back into a tight budget", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, 12);
      const tight = await runCli(repo, ["load", "--route", "demo", "--budget", "60"]);
      const tightParsed = JSON.parse(tight.stdout);
      const droppedId: string | undefined = tightParsed.budget.dropped[0]?.id;
      expect(droppedId).toBeDefined();

      const expanded = await runCli(repo, ["load", "--route", "demo", "--budget", "60", "--expand", droppedId!]);
      const expandedParsed = JSON.parse(expanded.stdout);
      expect(expandedParsed.facts.some((f: { id: string }) => f.id === droppedId)).toBe(true);
    });
  });

  test("--budget rejects non-positive values", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, 3);
      const result = await runCli(repo, ["load", "--route", "demo", "--budget", "0"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("positive integer");
    });
  });
});
