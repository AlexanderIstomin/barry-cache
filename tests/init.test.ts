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
      await expect(stat(join(repo, "docs/context/adrs/README.md"))).resolves.toBeTruthy();
      await expect(stat(join(repo, "docs/context/schema/fact.schema.json"))).resolves.toBeTruthy();
      await expect(stat(join(repo, "docs/context/schema/adr.schema.json"))).resolves.toBeTruthy();
      await expect(stat(join(repo, ".cursor/rules/barry-cache.mdc"))).resolves.toBeTruthy();

      const packageJson = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
      expect(packageJson.scripts.barry).toBe("barry-cache");
      expect(packageJson.scripts["barry:validate"]).toBe("barry-cache validate");
      expect(packageJson.scripts["barry:resume"]).toBe("barry-cache resume");
      expect(packageJson.scripts["barry:finalize"]).toBe("barry-cache finalize");
      expect(packageJson.scripts["barry:failure"]).toBe("barry-cache failure");
      expect(packageJson.scripts.context).toBeUndefined();
      expect(packageJson.scripts["context:validate"]).toBeUndefined();

      const agents = await readFile(join(repo, "AGENTS.md"), "utf8");
      expect(agents).toContain("Barry Cache");
      expect(agents).toContain("bun run barry -- resume --task");
      expect(agents).toContain("bun run barry -- validate");
      expect(agents).toContain("bun run barry -- failure record --summary");
      expect(agents).toContain("Do not claim Barry canonical memory is updated unless `docs/context/` changed.");
      expect(agents).toContain("Finalize writes operational memory only.");
      expect(agents).toContain("Failure records write operational validation memory only");
      expect(agents).toContain("There is no `fact` CLI command;");
      expect(agents).toContain("Use ISO 8601 timestamps in fact `updated_at` values when saving new facts");
      expect(agents).toContain("Use collision-resistant fact IDs like `REV-20260526T160512Z-a8f3`; dense review UI may display them as `REV-a8f3`.");
      expect(agents).toContain("run `bun install` first");
      expect(agents).not.toContain("barry-cache resume --task");
      expect(agents).toContain("Decision records:");
      expect(agents).toContain('bun run barry -- adr new --title "<decision>" --tags "<tags>"');
      expect(agents).toContain('Add or update a `kind: "decision"` fact');
      expect(agents).toContain("Do not create ADRs for routine bug fixes");

      // Non-codex adapters are thin stubs that point at the canonical AGENTS.md.
      const cursor = await readFile(join(repo, ".cursor/rules/barry-cache.mdc"), "utf8");
      expect(cursor).toContain("Barry Cache");
      expect(cursor).toContain("bun run barry -- resume --task");
      expect(cursor).toContain("`AGENTS.md`");
      expect(cursor).toContain("<!-- barry-cache:start -->");
      // The full memory policy now lives only in AGENTS.md, not in every stub.
      expect(cursor).not.toContain("There is no `fact` CLI command;");
      expect(cursor).not.toContain("Do not create ADRs for routine bug fixes");

      const claude = await readFile(join(repo, "CLAUDE.md"), "utf8");
      expect(claude).toContain("`AGENTS.md`");
      expect(claude).toContain("bun run barry -- resume --task");

      const maintenance = await readFile(join(repo, "docs/context/MAINTENANCE.md"), "utf8");
      expect(maintenance).toContain("Save an agent session");
      expect(maintenance).toContain("barry-cache finalize");
      expect(maintenance).toContain("barry-cache failure record");
      expect(maintenance).toContain("link the follow-up finalize with --fixes");

      const gitignore = await readFile(join(repo, ".gitignore"), "utf8");
      expect(gitignore).toContain(".barry-cache/");

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

  test("uses the package manager field in generated agent instructions", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({ name: "fixture", packageManager: "pnpm@10.0.0" }, null, 2),
      );

      await initProject({ repo, yes: true, agents: ["codex"] });

      const agents = await readFile(join(repo, "AGENTS.md"), "utf8");
      expect(agents).toContain("pnpm run barry -- resume --task");
      expect(agents).toContain("pnpm run barry -- validate");
      expect(agents).toContain("run `pnpm install` first");
      expect(agents).not.toContain("barry-cache resume --task");
    });
  });

  test("does not add barry-cache as a dependency when initializing barry-cache itself", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "barry-cache",
          scripts: { test: "bun test" },
          devDependencies: { typescript: "^6.0.3" },
        }, null, 2),
      );
      await writeFile(join(repo, "bun.lock"), "");

      await initProject({ repo, yes: true, agents: ["codex"] });

      const packageJson = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
      expect(packageJson.scripts.barry).toBe("bun run src/cli.ts");
      expect(packageJson.scripts["barry:validate"]).toBe("bun run src/cli.ts validate");
      expect(packageJson.scripts["barry:resume"]).toBe("bun run src/cli.ts resume");
      expect(packageJson.scripts["barry:finalize"]).toBe("bun run src/cli.ts finalize");
      expect(packageJson.scripts["barry:failure"]).toBe("bun run src/cli.ts failure");
      expect(packageJson.devDependencies).toEqual({ typescript: "^6.0.3" });
    });
  });
});
