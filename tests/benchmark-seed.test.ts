import { describe, expect, test } from "bun:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { seedBenchmarkTasks, writeSeededTasks } from "../src/core/benchmark";
import { finalizeProject } from "../src/core/context";
import { withTempRepo } from "./helpers";

async function addPack(repo: string): Promise<void> {
  const dir = join(repo, "docs/context/features/renderer");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# renderer\n\nrenderer summary.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `F01`: src/runtime/clock.ts\n");
  await writeFile(join(dir, "KG.adj"), "A owns B\n");
  await writeFile(join(dir, "FACTS.jsonl"), JSON.stringify({
    id: "REN0", subject: "S", predicate: "p", object: "clock",
    src: ["F01"], status: "active", kind: "implemented", updated_at: "2026-05-01T00:00:00.000Z",
  }) + "\n");
}

describe("benchmark seed", () => {
  test("infers expect_packs from handoff files via IDMAP", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      await finalizeProject({
        repo, status: "success", summary: "Fixed renderer clock drift",
        files: ["src/runtime/clock.ts"],
      });
      const { candidates } = await seedBenchmarkTasks({ repo });
      expect(candidates[0]?.task).toBe("Fixed renderer clock drift");
      expect(candidates[0]?.expect_packs).toContain("renderer");
    });
  });

  test("write appends new rows and dedupes by task", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      await finalizeProject({ repo, status: "success", summary: "Fixed renderer clock drift", files: ["src/runtime/clock.ts"] });
      const first = await seedBenchmarkTasks({ repo });
      const w1 = await writeSeededTasks({ repo, candidates: first.candidates });
      expect(w1.written).toBe(1);
      const second = await seedBenchmarkTasks({ repo });
      const w2 = await writeSeededTasks({ repo, candidates: second.candidates });
      expect(w2.written).toBe(0); // already present => deduped
      const content = await readFile(join(repo, "docs/context/benchmarks/tasks.jsonl"), "utf8");
      expect(content.trim().split(/\n/)).toHaveLength(1);
    });
  });
});
