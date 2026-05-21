import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

describe("finalize cli", () => {
  test("plain output distinguishes operational handoff from canonical memory", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: ["codex"] });

      const proc = Bun.spawn([process.execPath, cliPath, "finalize", "--status", "success", "--summary", "Added transcript checkbox."], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("Saved operational handoff to .context-state/handoffs/handoffs.jsonl.");
      expect(stdout).toContain("Finalize writes operational memory only; it does not update canonical context in docs/context/.");
      expect(stdout).toContain("If this task introduced durable implementation behavior, add or update docs/context/features/*/FACTS.jsonl and run barry-cache validate.");
    });
  });
});
