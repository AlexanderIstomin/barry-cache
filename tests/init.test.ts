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

      const first = await initProject({ repo, yes: true });
      const second = await initProject({ repo, yes: true });

      expect(first.written.length).toBeGreaterThan(5);
      expect(second.changed).toBe(false);
      await expect(stat(join(repo, "docs/context/INDEX.md"))).resolves.toBeTruthy();
      await expect(stat(join(repo, "docs/context/schema/fact.schema.json"))).resolves.toBeTruthy();
      await expect(stat(join(repo, ".cursor/rules/barry-cache.mdc"))).resolves.toBeTruthy();

      const packageJson = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
      expect(packageJson.scripts.context).toBe("barry-cache");
      expect(packageJson.scripts["context:validate"]).toBe("barry-cache validate");

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
});
