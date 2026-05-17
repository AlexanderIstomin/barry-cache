import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function addPack(repo: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/planner");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), "# Planner\n\nOwns planning memory.\n");
  await writeFile(join(featureDir, "IDMAP.md"), "- `F01`: src/planner.ts\n");
  await writeFile(join(featureDir, "KG.adj"), "planner owns memory\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    JSON.stringify({
      id: "PL001",
      subject: "planner",
      predicate: "owns",
      object: "planning memory",
      src: ["F01"],
      status: "active",
      kind: "implemented",
      updated_at: "2026-05-17",
    }) + "\n",
  );
}

describe("review cli", () => {
  test("prints the review model as json", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo);

      const proc = Bun.spawn([process.execPath, cliPath, "review", "--json"], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(stderr).toBe("");
      expect(code).toBe(0);
      const model = JSON.parse(stdout);
      expect(model.summary.features).toBe(1);
      expect(model.nodes.some((node: { id: string }) => node.id === "feature:planner")).toBe(true);
    });
  });
});
