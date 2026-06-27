import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
import { withTempRepo } from "./helpers";

async function addFeature(repo: string, slug: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features", slug);
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), `# ${slug}\n`);
  await writeFile(join(featureDir, "IDMAP.md"), "# ID Map\n");
  await writeFile(join(featureDir, "KG.adj"), "");
  await writeFile(join(featureDir, "FACTS.jsonl"), "");
}

describe("workspace validation", () => {
  test("ignores an absent workspace registry", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });

      const result = await validateProject({ repo });

      expect(result.ok).toBe(true);
      expect(result.errors.some((error) => error.file === "docs/context/workspaces.json")).toBe(false);
    });
  });

  test("reports malformed workspace registry entries", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addFeature(repo, "payments-api");
      await mkdir(join(repo, "services/payments"), { recursive: true });
      await writeFile(join(repo, "docs/context/workspaces.json"), JSON.stringify({
        version: 1,
        selection: { mode: "surprise" },
        workspaces: [
          {
            slug: "payments",
            title: "Payments",
            aliases: ["refunds", "refunds"],
            paths: ["services/payments/**"],
            routes: ["payments-api", "missing-route"],
            depends_on: ["missing-workspace"],
          },
          {
            slug: "payments",
            title: "Duplicate Payments",
            paths: ["services/missing/**"],
            routes: [],
          },
        ],
      }, null, 2));

      const result = await validateProject({ repo });

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "invalid workspace selection mode: surprise",
      }));
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "duplicate workspace slug: payments",
      }));
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "workspace payments has duplicate alias: refunds",
      }));
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "workspace payments references unknown route: missing-route",
      }));
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "workspace payments depends on unknown workspace: missing-workspace",
      }));
      expect(result.warnings).toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "workspace payments path matched no files: services/missing/**",
      }));
    });
  });

  test("accepts recursive workspace path patterns with wildcard prefixes", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await addFeature(repo, "ui");
      await mkdir(join(repo, "packages/ui/src"), { recursive: true });
      await writeFile(join(repo, "docs/context/workspaces.json"), JSON.stringify({
        version: 1,
        selection: { mode: "require-when-ambiguous" },
        workspaces: [
          {
            slug: "ui",
            title: "UI",
            paths: ["packages/*/src/**"],
            routes: ["ui"],
          },
        ],
      }, null, 2));

      const result = await validateProject({ repo });

      expect(result.ok).toBe(true);
      expect(result.warnings).not.toContainEqual(expect.objectContaining({
        file: "docs/context/workspaces.json",
        message: "workspace ui path matched no files: packages/*/src/**",
      }));
    });
  });
});
