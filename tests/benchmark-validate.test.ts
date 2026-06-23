import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { validateProject, benchmarkTaskErrors } from "../src/core/validate";
import { withTempRepo } from "./helpers";

describe("benchmark fixture validation", () => {
  test("benchmarkTaskErrors flags missing/mistyped fields", () => {
    expect(benchmarkTaskErrors({ id: "B1", task: "t", expect_packs: ["demo"] })).toEqual([]);
    expect(benchmarkTaskErrors({ id: "B1", task: "t" })).toContain("missing required field: expect_packs");
    expect(benchmarkTaskErrors({ id: "B1", task: "t", expect_packs: [] })).toContain("invalid field: expect_packs");
    expect(benchmarkTaskErrors({ id: "B1", task: "t", expect_packs: ["demo"], budget: 0 })).toContain("invalid field: budget");
  });

  test("validateProject reports malformed fixture rows by line", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      const dir = join(repo, "docs/context/benchmarks");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "tasks.jsonl"), '{"id":"B1","task":"t"}\n');
      const result = await validateProject({ repo });
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/benchmarks/tasks.jsonl",
        line: 1,
        message: "missing required field: expect_packs",
      }));
    });
  });

  test("validateProject ignores an absent fixtures file", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      const result = await validateProject({ repo });
      expect(result.ok).toBe(true);
    });
  });
});
