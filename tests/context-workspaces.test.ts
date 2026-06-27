import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resumeProject, routeTask, searchContext } from "../src/core/context";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

async function addFeature(repo: string, slug: string, title: string, source: string, terms: string[]): Promise<void> {
  const featureDir = join(repo, "docs/context/features", slug);
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), `# ${title}\n\nOwns ${terms.join(" ")} behavior.\n`);
  await writeFile(join(featureDir, "IDMAP.md"), `# ID Map\n\n- \`SRC\`: ${source}\n`);
  await writeFile(join(featureDir, "KG.adj"), `${slug} owns ${terms[0] ?? "behavior"}\n`);
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    JSON.stringify({
      id: `${slug.toUpperCase().replace(/-/g, "_")}-001`,
      subject: title,
      predicate: "owns",
      object: terms.join(" "),
      src: ["SRC"],
      status: "active",
      kind: "implemented",
      updated_at: "2026-06-01T00:00:00.000Z",
      tags: terms,
    }) + "\n",
  );
}

async function writeWorkspaceConfig(repo: string, selectionMode = "require-when-ambiguous"): Promise<void> {
  await writeFile(join(repo, "docs/context/workspaces.json"), JSON.stringify({
    version: 1,
    selection: { mode: selectionMode },
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
      {
        slug: "marketing",
        title: "Marketing",
        aliases: ["campaigns"],
        paths: ["apps/marketing/**"],
        routes: ["marketing-site"],
      },
    ],
  }, null, 2));
}

async function setupWorkspaceRepo(repo: string): Promise<void> {
  await initProject({ repo, yes: true, agents: [] });
  await mkdir(join(repo, "services/payments/webhooks"), { recursive: true });
  await mkdir(join(repo, "services/auth"), { recursive: true });
  await mkdir(join(repo, "apps/marketing"), { recursive: true });
  await writeFile(join(repo, "services/payments/webhooks/refund.ts"), "export const refund = true;\n");
  await writeFile(join(repo, "services/auth/session.ts"), "export const session = true;\n");
  await writeFile(join(repo, "apps/marketing/page.ts"), "export const page = true;\n");
  await addFeature(repo, "payments-api", "Payments API", "services/payments/webhooks/refund.ts", ["payments", "refunds"]);
  await addFeature(repo, "auth-api", "Auth API", "services/auth/session.ts", ["auth", "identity"]);
  await addFeature(repo, "marketing-site", "Marketing Site", "apps/marketing/page.ts", ["campaigns", "landing"]);
  await writeWorkspaceConfig(repo);
}

describe("workspace-aware context loading", () => {
  test("routeTask boosts selected workspace and dependency routes", async () => {
    await withTempRepo(async (repo) => {
      await setupWorkspaceRepo(repo);

      const result = await routeTask({
        repo,
        task: "maintenance cleanup",
        workspace: "payments",
      });

      expect(result.workspace_decision).toMatchObject({
        status: "selected",
        workspace: "payments",
        source: "explicit",
        dependencies: ["auth"],
      });
      expect(result.routes.map((route) => route.slug)).toEqual(["payments-api", "auth-api"]);
      expect(result.routes[0]?.reason).toContain("workspace payments");
      expect(result.routes[1]?.reason).toContain("dependency of payments");
    });
  });

  test("resumeProject infers workspace from paths and includes workspace guidance", async () => {
    await withTempRepo(async (repo) => {
      await setupWorkspaceRepo(repo);

      const result = await resumeProject({
        repo,
        task: "fix identity checkout flow",
        paths: ["services/payments/webhooks/refund.ts"],
        budget: 2000,
      });

      expect(result.workspace_decision).toMatchObject({
        status: "selected",
        workspace: "payments",
        source: "path",
      });
      expect(result.execution_contract.first_action).toContain("payments workspace context");
      expect(result.execution_contract.edit_scope).toContain("services/payments/**");
      expect(result.execution_contract.edit_scope).toContain("docs/context/features/payments-api/**");
      expect(result.context.routes[0]?.slug).toBe("payments-api");
      expect(result.context_preview?.feature.slug).toBe("payments-api");
    });
  });

  test("resumeProject requires user selection when workspace inference is ambiguous", async () => {
    await withTempRepo(async (repo) => {
      await setupWorkspaceRepo(repo);

      const result = await resumeProject({ repo, task: "fix checkout state", budget: 2000 });

      expect(result.workspace_decision).toMatchObject({
        status: "ambiguous",
        candidates: ["auth", "payments"],
        required_action: "rerun with --workspace <slug> or ask the user",
      });
      expect(result.execution_contract.first_action).toContain("resolve workspace ambiguity");
      expect(result.context_preview).toBeUndefined();
    });
  });

  test("searchContext can prefer workspace routes without hiding global matches", async () => {
    await withTempRepo(async (repo) => {
      await setupWorkspaceRepo(repo);

      const result = await searchContext({
        repo,
        query: "identity refunds",
        workspace: "payments",
      });

      expect(result.workspace_decision).toMatchObject({
        status: "selected",
        workspace: "payments",
      });
      expect(result.results[0]?.route).toBe("payments-api");
      expect(result.results.some((item) => item.route === "auth-api")).toBe(true);
    });
  });
});
