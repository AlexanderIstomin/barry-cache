import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function runCli(repo: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([process.execPath, cliPath, ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { stdout, stderr, code };
}

async function addFeature(repo: string, slug: string, source: string, terms: string[]): Promise<void> {
  const featureDir = join(repo, "docs/context/features", slug);
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), `# ${slug}\n\n${terms.join(" ")}\n`);
  await writeFile(join(featureDir, "IDMAP.md"), `# ID Map\n\n- \`SRC\`: ${source}\n`);
  await writeFile(join(featureDir, "KG.adj"), `${slug} owns ${terms[0] ?? "behavior"}\n`);
  await writeFile(join(featureDir, "FACTS.jsonl"), JSON.stringify({
    id: `${slug.toUpperCase().replace(/-/g, "_")}-001`,
    subject: slug,
    predicate: "owns",
    object: terms.join(" "),
    src: ["SRC"],
    status: "active",
    kind: "implemented",
    updated_at: "2026-06-01T00:00:00.000Z",
  }) + "\n");
}

async function setupWorkspaceRepo(repo: string): Promise<void> {
  await initProject({ repo, yes: true, agents: [] });
  await mkdir(join(repo, "services/payments"), { recursive: true });
  await writeFile(join(repo, "services/payments/refund.ts"), "export const refund = true;\n");
  await addFeature(repo, "payments-api", "services/payments/refund.ts", ["payments", "refunds"]);
  await writeFile(join(repo, "docs/context/workspaces.json"), JSON.stringify({
    version: 1,
    selection: { mode: "require-when-ambiguous" },
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

describe("workspace cli", () => {
  test("workspace list and infer expose workspace decisions", async () => {
    await withTempRepo(async (repo) => {
      await setupWorkspaceRepo(repo);

      const listed = await runCli(repo, ["workspace", "list", "--json"]);
      expect(listed.stderr).toBe("");
      expect(listed.code).toBe(0);
      expect(JSON.parse(listed.stdout).workspaces[0].slug).toBe("payments");

      const inferred = await runCli(repo, [
        "workspace",
        "infer",
        "--task",
        "fix refunds",
        "--paths",
        "services/payments/refund.ts",
        "--json",
      ]);
      expect(inferred.stderr).toBe("");
      expect(inferred.code).toBe(0);
      expect(JSON.parse(inferred.stdout).decision).toMatchObject({
        status: "selected",
        workspace: "payments",
        source: "path",
      });
    });
  });

  test("route and resume accept workspace hints", async () => {
    await withTempRepo(async (repo) => {
      await setupWorkspaceRepo(repo);

      const route = await runCli(repo, ["route", "--task", "maintenance cleanup", "--workspace", "payments", "--json"]);
      expect(route.stderr).toBe("");
      expect(route.code).toBe(0);
      expect(JSON.parse(route.stdout).routes[0]).toMatchObject({
        slug: "payments-api",
      });

      const resume = await runCli(repo, [
        "resume",
        "--task",
        "fix refunds",
        "--paths",
        "services/payments/refund.ts",
        "--json",
      ]);
      expect(resume.stderr).toBe("");
      expect(resume.code).toBe(0);
      const parsed = JSON.parse(resume.stdout);
      expect(parsed.workspace_decision).toMatchObject({
        status: "selected",
        workspace: "payments",
        source: "path",
      });
      expect(parsed.execution_contract.edit_scope).toContain("services/payments/**");
    });
  });
});
