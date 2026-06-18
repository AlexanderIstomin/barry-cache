import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("cli argument help", () => {
  test("import without arguments explains required flags and available sources", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["import"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Missing required --source");
      expect(result.stderr).toContain("Usage:");
      expect(result.stderr).toContain("barry-cache import --source pulpcut-kb --from /path/to/repo");
      expect(result.stderr).toContain("Available --source values:");
      expect(result.stderr).toContain("pulpcut-kb");
    });
  });

  test("import with dangling source flag shows source choices", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["import", "--source"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--source requires a value");
      expect(result.stderr).toContain("Available --source values:");
      expect(result.stderr).toContain("pulpcut-kb");
    });
  });

  test("import with unsupported source shows source choices", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["import", "--source", "unknown", "--from", repo]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unsupported import source: unknown");
      expect(result.stderr).toContain("Available --source values:");
      expect(result.stderr).toContain("pulpcut-kb");
    });
  });

  test("route without task shows command usage", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["route"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Missing required --task");
      expect(result.stderr).toContain("barry-cache route --task");
    });
  });

  test("failure record without actual behavior shows command usage", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["failure", "record", "--summary", "Broken export", "--expected", "Export succeeds"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Missing required --actual");
      expect(result.stderr).toContain("barry-cache failure record --summary");
    });
  });

  test("json argument errors stay machine readable", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["import", "--source", "--json"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("--source requires a value");
      expect(parsed.usage).toContain("barry-cache import --source pulpcut-kb --from /path/to/repo");
      expect(parsed.options.source).toEqual(["pulpcut-kb"]);
    });
  });

  test("kb validate without source shows command usage", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "validate"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Missing required --source");
      expect(result.stderr).toContain("barry-cache kb validate --source /path/to/shared-kb");
    });
  });

  test("kb sharing rejects unsupported modes with available choices", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "sharing", "set", "red-pill"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unsupported shared KB contribution mode: red-pill");
      expect(result.stderr).toContain("barry-cache kb sharing set <local-only|preview-only|share-enabled>");
      expect(result.stderr).toContain("Available mode values:");
      expect(result.stderr).toContain("local-only");
      expect(result.stderr).toContain("preview-only");
      expect(result.stderr).toContain("share-enabled");
    });
  });
});
