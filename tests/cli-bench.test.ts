import { describe, expect, test } from "bun:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { finalizeProject } from "../src/core/context";
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
  const dir = join(repo, "docs/context/features/renderer");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# renderer\n\nrenderer summary.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `F01`: src/runtime/clock.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  await writeFile(join(dir, "FACTS.jsonl"), JSON.stringify({
    id: "REN0", subject: "S", predicate: "p", object: "transport clock drift",
    src: ["F01"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
  }) + "\n");
}

describe("bench command (CLI)", () => {
  test("bench run with no fixtures prints a friendly message and exits 0", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      const result = await runCli(repo, ["bench", "run"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("No benchmark fixtures found");
    });
  });

  test("bench run reports recall and savings as JSON", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      const benchDir = join(repo, "docs/context/benchmarks");
      await mkdir(benchDir, { recursive: true });
      await writeFile(join(benchDir, "tasks.jsonl"),
        JSON.stringify({ id: "B1", task: "fix transport clock drift", expect_packs: ["renderer"], expect_facts: ["REN0"] }) + "\n");
      const result = await runCli(repo, ["bench", "run", "--json"]);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.tasks[0].pack_recall).toBe(1);
      expect(parsed.tasks[0].fact_recall).toBe(1);
    });
  });

  test("bench seed --write appends inferred fixtures from handoffs", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      await finalizeProject({ repo, status: "success", summary: "Fixed transport clock drift", files: ["src/runtime/clock.ts"] });
      const result = await runCli(repo, ["bench", "seed", "--write"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Appended 1 benchmark fixture");
      const content = await readFile(join(repo, "docs/context/benchmarks/tasks.jsonl"), "utf8");
      expect(content).toContain("Fixed transport clock drift");
      expect(content).toContain("renderer");
    });
  });
});
