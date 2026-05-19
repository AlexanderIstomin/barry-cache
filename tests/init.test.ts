import { describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
import { withTempRepo } from "./helpers";

describe("initProject", () => {
  test("creates a usable context setup and is idempotent", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({ name: "fixture", scripts: { test: "bun test" } }, null, 2),
      );
      await writeFile(join(repo, "bun.lock"), "");

      const first = await initProject({ repo, yes: true });
      const second = await initProject({ repo, yes: true });

      expect(first.written.length).toBeGreaterThan(5);
      expect(first.packageManager?.name).toBe("bun");
      expect(first.packageManager?.installCommand).toBe("bun install");
      expect(second.changed).toBe(false);
      await expect(stat(join(repo, "docs/context/INDEX.md"))).resolves.toBeTruthy();
      await expect(stat(join(repo, "docs/context/schema/fact.schema.json"))).resolves.toBeTruthy();
      await expect(stat(join(repo, ".cursor/rules/barry-cache.mdc"))).resolves.toBeTruthy();

      const packageJson = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
      expect(packageJson.scripts.barry).toBe("barry-cache");
      expect(packageJson.scripts["barry:validate"]).toBe("barry-cache validate");
      expect(packageJson.scripts["barry:resume"]).toBe("barry-cache resume");
      expect(packageJson.scripts["barry:finalize"]).toBe("barry-cache finalize");
      expect(packageJson.scripts.context).toBeUndefined();
      expect(packageJson.scripts["context:validate"]).toBeUndefined();

      const agents = await readFile(join(repo, "AGENTS.md"), "utf8");
      expect(agents).toContain("Barry Cache");
      expect(agents).toContain("barry-cache resume --task");

      const maintenance = await readFile(join(repo, "docs/context/MAINTENANCE.md"), "utf8");
      expect(maintenance).toContain("Save an agent session");
      expect(maintenance).toContain("barry-cache finalize");

      const validation = await validateProject({ repo });
      expect(validation.ok).toBe(true);
    });
  });

  test("dry run reports writes without touching the repo", async () => {
    await withTempRepo(async (repo) => {
      const result = await initProject({ repo, yes: true, dryRun: true });

      expect(result.changed).toBe(true);
      expect(result.written).toContain("docs/context/INDEX.md");
      await expect(stat(join(repo, "docs/context/INDEX.md"))).rejects.toThrow();
    });
  });

  test("can limit generated agent instructions to codex", async () => {
    await withTempRepo(async (repo) => {
      const result = await initProject({ repo, yes: true, agents: ["codex"] });

      expect(result.written).toContain("AGENTS.md");
      expect(result.written).not.toContain(".github/copilot-instructions.md");
      expect(result.written).not.toContain(".cursor/rules/barry-cache.mdc");
      expect(result.written).not.toContain("CLAUDE.md");
      expect(result.written).not.toContain("GEMINI.md");
      expect(result.written).not.toContain("llms.txt");
      await expect(stat(join(repo, "AGENTS.md"))).resolves.toBeTruthy();
      await expect(stat(join(repo, ".github/copilot-instructions.md"))).rejects.toThrow();
      await expect(stat(join(repo, ".cursor/rules/barry-cache.mdc"))).rejects.toThrow();
      await expect(stat(join(repo, "CLAUDE.md"))).rejects.toThrow();
      await expect(stat(join(repo, "GEMINI.md"))).rejects.toThrow();
      await expect(stat(join(repo, "llms.txt"))).rejects.toThrow();
    });
  });
});
