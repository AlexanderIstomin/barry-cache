import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

describe("init cli", () => {
  test("plain dry-run output lists planned file changes", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(join(repo, "package.json"), JSON.stringify({ name: "fixture" }, null, 2));
      await writeFile(join(repo, "bun.lock"), "");

      const proc = Bun.spawn([process.execPath, cliPath, "init", "--dry-run"], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("Barry Cache init would change files.");
      expect(stdout).toContain("Create:");
      expect(stdout).toContain("  AGENTS.md");
      expect(stdout).toContain("  docs/context/INDEX.md");
      expect(stdout).toContain("After applying, run: bun install");
      expect(stdout).toContain("\u001b[32mAfter applying, run: bun install\u001b[0m");
    });
  });

  test("dry-run can limit planned agent instruction files", async () => {
    await withTempRepo(async (repo) => {
      const proc = Bun.spawn([process.execPath, cliPath, "init", "--dry-run", "--agents", "codex"], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("  AGENTS.md");
      expect(stdout).not.toContain("  .github/copilot-instructions.md");
      expect(stdout).not.toContain("  .cursor/rules/barry-cache.mdc");
      expect(stdout).not.toContain("  CLAUDE.md");
      expect(stdout).not.toContain("  GEMINI.md");
      expect(stdout).not.toContain("  llms.txt");
    });
  });
});
