import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function runCli(repo: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { stdout, stderr, code };
}

describe("adr cli", () => {
  test("creates and lists ADRs", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });

      const created = await runCli(repo, ["adr", "new", "--title", "Use repo-native context", "--tags", "context,agents"]);
      expect(created.stderr).toBe("");
      expect(created.code).toBe(0);
      expect(created.stdout).toContain("Created ADR-0001");
      expect(created.stdout).toContain("docs/context/adrs/ADR-0001-use-repo-native-context.md");

      const listed = await runCli(repo, ["adr", "list", "--json"]);
      expect(listed.stderr).toBe("");
      expect(listed.code).toBe(0);
      const parsed = JSON.parse(listed.stdout);
      expect(parsed.adrs).toContainEqual(expect.objectContaining({
        id: "ADR-0001",
        title: "Use repo-native context",
        tags: ["context", "agents"],
      }));
    });
  });

  test("new without title shows ADR usage", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["adr", "new"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Missing required --title");
      expect(result.stderr).toContain("barry-cache adr new --title");
    });
  });
});
