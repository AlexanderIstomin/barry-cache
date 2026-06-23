import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { runBenchmark, readBenchmarkTasks } from "../src/core/benchmark";
import { withTempRepo } from "./helpers";

async function addPack(repo: string, slug: string, factObjects: string[]): Promise<void> {
  const dir = join(repo, "docs/context/features/" + slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), `# ${slug}\n\n${slug} summary.\n`);
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `X1`: src/x.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  const rows = factObjects.map((object, i) => JSON.stringify({
    id: `${slug.toUpperCase()}${i}`, subject: "S", predicate: "p", object,
    src: ["X1"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
  }));
  await writeFile(join(dir, "FACTS.jsonl"), rows.join("\n") + "\n");
}

async function writeFixtures(repo: string, lines: object[]): Promise<void> {
  const dir = join(repo, "docs/context/benchmarks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("benchmark run", () => {
  test("missing fixtures => empty report", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      const { tasks } = await readBenchmarkTasks(repo);
      expect(tasks).toHaveLength(0);
      const report = await runBenchmark({ repo });
      expect(report.tasks).toHaveLength(0);
    });
  });

  test("computes recall and savings for a fixture", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, "renderer", ["transport clock drift", "frame scheduler", "buffer pool", "audio sync"]);
      await writeFixtures(repo, [
        { id: "B1", task: "fix transport clock drift in renderer", expect_packs: ["renderer"], expect_facts: ["RENDERER0"], budget: 200 },
      ]);
      const report = await runBenchmark({ repo });
      expect(report.tasks[0]?.pack_recall).toBe(1);
      expect(report.tasks[0]?.fact_recall).toBe(1);
      expect(report.tasks[0]?.tokens_saved_pct).toBeGreaterThan(0);
      expect(report.recall_regressions).toBe(0);
    });
  });

  test("counts a recall regression when an expected pack is not routed", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo, "renderer", ["transport clock drift"]);
      await writeFixtures(repo, [
        { id: "B2", task: "transport clock drift", expect_packs: ["nonexistent-pack"] },
      ]);
      const report = await runBenchmark({ repo });
      expect(report.tasks[0]?.pack_recall).toBe(0);
      expect(report.recall_regressions).toBe(1);
    });
  });
});
