import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function lesson(id = "lesson-20260603-a8f3"): Record<string, unknown> {
  return {
    id,
    kind: "anti_pattern",
    status: "trusted",
    title: "Treat handoffs as claims until validated",
    problem: "Agents may treat previous handoff summaries as proof of correctness.",
    applies_when: ["multi-agent coding workflow", "handoff records exist"],
    recommendation: "Record user-observed failures as contradiction events.",
    why: "This prevents stale claims from becoming canonical truth.",
    avoid_when: ["the source cannot be safely anonymized"],
    confidence: "high",
    evidence: {
      source_type: "anonymized_project_pattern",
      count: 1,
      has_follow_up_fix: true,
    },
    tags: ["agents", "validation"],
    updated_at: "2026-06-03T10:00:00.000Z",
  };
}

describe("kb cli", () => {
  test("reports local-only sharing by default", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "sharing", "status"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Shared KB contribution mode: local-only");
      expect(result.stdout).toContain("Barry will not send shared KB contributions.");
    });
  });

  test("sets preview-only sharing mode without enabling sending", async () => {
    await withTempRepo(async (repo) => {
      const set = await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      expect(set.stderr).toBe("");
      expect(set.code).toBe(0);
      expect(set.stdout).toContain("Shared KB contribution mode: preview-only");
      expect(set.stdout).toContain("Barry can show shared KB payloads locally, but sending remains disabled.");

      const status = await runCli(repo, ["kb", "sharing", "status", "--json"]);
      expect(status.stderr).toBe("");
      expect(status.code).toBe(0);
      expect(JSON.parse(status.stdout)).toEqual({
        shared_kb: {
          contribution: "preview_only",
        },
      });
    });
  });

  test("sets share-enabled mode with explicit send warning", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "sharing", "set", "share-enabled"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Shared KB contribution mode: share-enabled");
      expect(result.stdout).toContain("Barry may send shared KB contributions only when a send command is invoked.");
    });
  });

  test("validates shared KB source directories", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson())}\n`);

      const result = await runCli(repo, ["kb", "validate", "--source", source]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Shared KB source is valid.");
      expect(result.stdout).toContain("1 lesson(s)");
    });
  });

  test("builds shared KB snapshots and searches trusted lessons", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      const out = join(repo, "dist/shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson())}\n`);

      const build = await runCli(repo, ["kb", "build", "--source", source, "--out", out]);
      expect(build.stderr).toBe("");
      expect(build.code).toBe(0);
      expect(build.stdout).toContain("Built shared KB snapshot at");
      expect(JSON.parse(await readFile(join(out, "manifest.json"), "utf8")).counts.lessons).toBe(1);

      const search = await runCli(repo, ["kb", "search", "--source", out, "--query", "handoff validation"]);
      expect(search.stderr).toBe("");
      expect(search.code).toBe(0);
      expect(search.stdout).toContain("lesson-20260603-a8f3");
      expect(search.stdout).toContain("Treat handoffs as claims until validated");
    });
  });

  test("blocks remote shared KB search unless sharing is enabled", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "search", "--source", "https://kb.example.com/latest", "--query", "validation"]);

      expect(result.stdout).toBe("");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Remote shared KB search requires share-enabled mode.");
      expect(result.stderr).toContain("barry-cache kb sharing set share-enabled");
    });
  });

  test("allows remote shared KB search when sharing is enabled", async () => {
    await withTempRepo(async (repo) => {
      const server = Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          if (url.pathname !== "/latest/indexes/search-index.json") return new Response("not found", { status: 404 });
          return Response.json({
            version: 1,
            generated_at: "2026-06-04T15:30:00.000Z",
            items: [{
              id: "lesson-20260604-commitment",
              kind: "lesson",
              status: "trusted",
              title: "Reciprocal shared KB access",
              summary: "Remote shared KB search is available to contributors.",
              tags: ["shared-kb", "commitment"],
              confidence: "high",
              updated_at: "2026-06-04T15:30:00.000Z",
              text: "remote shared kb commitment validation",
            }],
          });
        },
      });

      try {
        const set = await runCli(repo, ["kb", "sharing", "set", "share-enabled"]);
        expect(set.code).toBe(0);

        const result = await runCli(repo, ["kb", "search", "--source", `${server.url}latest`, "--query", "commitment validation"]);

        expect(result.stderr).toBe("");
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("lesson-20260604-commitment");
        expect(result.stdout).toContain("Reciprocal shared KB access");
      } finally {
        server.stop(true);
      }
    });
  });

  test("json output is machine-readable", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson())}\n`);

      const result = await runCli(repo, ["kb", "validate", "--source", source, "--json"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.lessons).toHaveLength(1);
    });
  });
});
