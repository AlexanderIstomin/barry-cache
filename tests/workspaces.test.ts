import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { pathMatchesWorkspacePattern, readWorkspaceConfig, selectWorkspace } from "../src/core/workspaces";
import { withTempRepo } from "./helpers";

async function writeWorkspaceConfig(repo: string): Promise<void> {
  await mkdir(join(repo, "docs/context"), { recursive: true });
  await writeFile(join(repo, "docs/context/workspaces.json"), JSON.stringify({
    version: 1,
    selection: { mode: "require-when-ambiguous" },
    workspaces: [
      {
        slug: "payments",
        title: "Payments",
        aliases: ["refunds", "checkout"],
        paths: ["services/payments/**"],
        routes: ["payments-api"],
        depends_on: ["auth"],
      },
      {
        slug: "auth",
        title: "Auth",
        aliases: ["identity", "checkout"],
        paths: ["services/auth/**"],
        routes: ["auth-api"],
      },
    ],
  }, null, 2));
}

async function writeWorkspaceConfigWithMode(repo: string, mode: string): Promise<void> {
  await mkdir(join(repo, "docs/context"), { recursive: true });
  await writeFile(join(repo, "docs/context/workspaces.json"), JSON.stringify({
    version: 1,
    selection: { mode },
    workspaces: [
      {
        slug: "payments",
        title: "Payments",
        aliases: ["refunds"],
        paths: ["services/payments/**"],
        routes: ["payments-api"],
      },
    ],
  }, null, 2));
}

describe("workspace selection", () => {
  test("reports disabled when no workspace registry exists", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });

      const config = await readWorkspaceConfig(repo);
      const decision = selectWorkspace(config, { task: "fix payments retry", paths: [] });

      expect(config.enabled).toBe(false);
      expect(decision).toMatchObject({
        status: "disabled",
        source: "none",
        evidence: ["docs/context/workspaces.json not found"],
      });
    });
  });

  test("explicit workspace wins over path and task hints", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await writeWorkspaceConfig(repo);

      const config = await readWorkspaceConfig(repo);
      const decision = selectWorkspace(config, {
        task: "fix identity session renewal",
        paths: ["services/auth/session.ts"],
        explicitWorkspace: "payments",
      });

      expect(decision).toMatchObject({
        status: "selected",
        workspace: "payments",
        source: "explicit",
      });
      expect(decision.evidence.join("\n")).toContain("--workspace payments");
    });
  });

  test("honors off selection mode without pretending the registry is absent", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await writeWorkspaceConfigWithMode(repo, "off");

      const config = await readWorkspaceConfig(repo);
      const decision = selectWorkspace(config, { task: "fix refunds", paths: [] });

      expect(decision).toMatchObject({
        status: "disabled",
        source: "none",
        evidence: ["workspace selection disabled by docs/context/workspaces.json"],
      });
    });
  });

  test("selects by path before task text and includes dependency evidence", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await writeWorkspaceConfig(repo);

      const config = await readWorkspaceConfig(repo);
      const decision = selectWorkspace(config, {
        task: "fix identity checkout flow",
        paths: ["services/payments/webhooks/refund.ts"],
      });

      expect(decision).toMatchObject({
        status: "selected",
        workspace: "payments",
        source: "path",
        dependencies: ["auth"],
      });
      expect(decision.evidence.join("\n")).toContain("services/payments/** matched services/payments/webhooks/refund.ts");
    });
  });

  test("reports ambiguous candidates instead of guessing", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await writeWorkspaceConfig(repo);

      const config = await readWorkspaceConfig(repo);
      const decision = selectWorkspace(config, { task: "fix checkout state", paths: [] });

      expect(decision).toMatchObject({
        status: "ambiguous",
        source: "task",
        candidates: ["auth", "payments"],
        required_action: "rerun with --workspace <slug> or ask the user",
      });
    });
  });

  test("throws on an unknown explicit workspace", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await writeWorkspaceConfig(repo);

      const config = await readWorkspaceConfig(repo);

      expect(() => selectWorkspace(config, {
        task: "fix refunds",
        paths: [],
        explicitWorkspace: "missing",
      })).toThrow("Unknown workspace: missing");
    });
  });

  test("matches single-star segments inside recursive path patterns", () => {
    expect(pathMatchesWorkspacePattern("packages/*/src/**", "packages/ui/src/button.ts")).toBe(true);
    expect(pathMatchesWorkspacePattern("packages/*/src/**", "packages/ui/test/button.ts")).toBe(false);
  });
});
