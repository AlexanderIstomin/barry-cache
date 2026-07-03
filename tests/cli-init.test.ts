import { describe, expect, test } from "bun:test";
import { stat, writeFile } from "node:fs/promises";
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

  test("--repo targets the given path, not the current working directory", async () => {
    await withTempRepo(async (target) => {
      await withTempRepo(async (cwd) => {
        const proc = Bun.spawn([process.execPath, cliPath, "init", "--repo", target, "--agents", "codex", "--yes"], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        // Drain stdout too so a full pipe buffer can't block the child.
        const [, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        expect(stderr).toBe("");
        expect(code).toBe(0);
        // Files land in the target repo...
        await expect(stat(join(target, "AGENTS.md"))).resolves.toBeTruthy();
        // ...and the process's own cwd is left untouched.
        await expect(stat(join(cwd, "AGENTS.md"))).rejects.toThrow();
      });
    });
  });

  test("--repo with a nonexistent path fails loudly instead of falling back to cwd", async () => {
    await withTempRepo(async (cwd) => {
      const missing = join(cwd, "does-not-exist");
      const proc = Bun.spawn([process.execPath, cliPath, "init", "--repo", missing, "--agents", "codex", "--yes"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      // Drain stdout too so a full pipe buffer can't block the child.
      const [, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(code).toBe(1);
      expect(stderr).toContain("--repo path does not exist or is not accessible");
      // The real cwd must not have been scaffolded as a side effect.
      await expect(stat(join(cwd, "AGENTS.md"))).rejects.toThrow();
    });
  });

  test("--repo pointing at a file (not a directory) fails loudly", async () => {
    await withTempRepo(async (cwd) => {
      const filePath = join(cwd, "a-file.txt");
      await writeFile(filePath, "not a repo");
      const proc = Bun.spawn([process.execPath, cliPath, "init", "--repo", filePath, "--agents", "codex", "--yes"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      // Drain stdout too so a full pipe buffer can't block the child.
      const [, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(code).toBe(1);
      expect(stderr).toContain("--repo path is not a directory");
    });
  });
});
