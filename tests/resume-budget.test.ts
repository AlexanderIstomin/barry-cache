import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resumeProject } from "../src/core/context";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

async function addPack(repo: string): Promise<void> {
  const dir = join(repo, "docs/context/features/renderer-runtime");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# Renderer Runtime\n\nOwns the transport clock.\n");
  await writeFile(join(dir, "IDMAP.md"), "# ID Map\n- `F01`: src/runtime/clock.ts\n");
  await writeFile(join(dir, "KG.adj"), "A0 owns transport-clock\n");
  await writeFile(join(dir, "FACTS.jsonl"), JSON.stringify({
    id: "RR001", subject: "A0", predicate: "owns", object: "transport clock drift",
    src: ["F01"], status: "active", kind: "implemented", updated_at: "2026-05-17T00:00:00.000Z",
  }) + "\n");
}

describe("resume budgeting", () => {
  test("no budget => no context_preview (backward compatible)", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      const resume = await resumeProject({ repo, task: "fix transport clock drift" });
      expect("context_preview" in resume).toBe(false);
    });
  });

  test("with budget => attaches a budgeted preview of the top route", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addPack(repo);
      const resume = await resumeProject({ repo, task: "fix transport clock drift", budget: 100000 });
      expect(resume.context_preview?.feature.slug).toBe("renderer-runtime");
      expect(resume.context_preview?.facts[0]?.id).toBe("RR001");
    });
  });
});
