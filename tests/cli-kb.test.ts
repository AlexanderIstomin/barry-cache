import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withTempRepo } from "./helpers";
import { createBrain } from "../brain/core/brain";
import { createSqliteStore } from "../brain/core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../brain/core/identity";
import { createRouter } from "../brain/http/router";
import { startBunServer } from "../brain/runtime/bun-server";

const proposeArgs = [
  "kb", "propose", "lesson",
  "--title", "Treat handoffs as claims until validated",
  "--problem", "Agents may trust stale handoff summaries.",
  "--applies-when", "multi-agent coding workflow",
  "--recommendation", "Validate claims before treating them as durable context.",
  "--why", "This prevents stale operational memory from becoming canonical truth.",
  "--avoid-when", "the source cannot be safely anonymized",
  "--tags", "agents,validation",
];

async function withBrain(fn: (url: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "cli-brain-"));
  const store = createSqliteStore(":memory:");
  await store.migrate();
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => new Date().toISOString() });
  const server = startBunServer({ router: createRouter({ brain, fingerprint: identity.fingerprint }), port: 0 });
  try {
    await fn(`http://localhost:${server.port}`);
  } finally {
    server.stop();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

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

  test("kb propose is blocked in local-only mode", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, proposeArgs);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("preview-only or share-enabled");
    });
  });

  test("kb propose --dry-run prints the lesson without queuing it", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      const result = await runCli(repo, [...proposeArgs, "--dry-run", "--json"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.lesson.status).toBe("submitted");
      expect(parsed.lesson.kind).toBe("lesson");
    });
  });

  test("kb submit requires share-enabled mode", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      const result = await runCli(repo, ["kb", "submit", "--brain", "https://brain.example.com"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("share-enabled");
    });
  });

  test("kb harvest is blocked in local-only mode", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "harvest", "--kind", "failure", "--summary", "Recurring validation failure"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("preview-only or share-enabled");
    });
  });

  test("kb harvest drafts a candidate + checklist from explicit flags", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      const result = await runCli(repo, ["kb", "harvest", "--kind", "failure", "--summary", "Recurring auth schema migration failure", "--expected", "migration succeeds", "--actual", "migration throws"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("kb propose lesson");
      expect(result.stdout.toLowerCase()).toContain("anonymize");
    });
  });

  test("kb harvest auto-reads the latest finalized run", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "share-enabled"]);
      await runCli(repo, ["finalize", "--status", "success", "--summary", "Implemented signed intake batch validation and schema migration guard"]);
      const result = await runCli(repo, ["kb", "harvest", "--json"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.candidates.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("kb attest requires share-enabled mode", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      const result = await runCli(repo, ["kb", "attest", "--lesson-id", "lesson-20260601-aaaa1111", "--brain", "https://brain.example.com"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("share-enabled");
    });
  });

  test("end-to-end: kb attest submits an outcome attestation to a Brain", async () => {
    await withTempRepo(async (repo) => {
      await withBrain(async (url) => {
        await runCli(repo, ["kb", "sharing", "set", "share-enabled"]);
        const propose = await runCli(repo, [...proposeArgs, "--json"]);
        const lessonId = JSON.parse(propose.stdout).lesson.id as string;
        await runCli(repo, ["kb", "submit", "--brain", url]);

        const attest = await runCli(repo, ["kb", "attest", "--lesson-id", lessonId, "--result", "confirmed", "--evidence-type", "observed_success", "--brain", url]);
        expect(attest.stderr).toBe("");
        expect(attest.code).toBe(0);
        expect(attest.stdout).toContain("Attested confirmed");
      });
    });
  });

  test("end-to-end: propose a lesson and submit it to a running Brain", async () => {
    await withTempRepo(async (repo) => {
      await withBrain(async (url) => {
        expect((await runCli(repo, ["kb", "sharing", "set", "share-enabled"])).code).toBe(0);

        const propose = await runCli(repo, proposeArgs);
        expect(propose.stderr).toBe("");
        expect(propose.code).toBe(0);
        expect(propose.stdout).toContain("Queued lesson");

        const submit = await runCli(repo, ["kb", "submit", "--brain", url]);
        expect(submit.stderr).toBe("");
        expect(submit.code).toBe(0);
        expect(submit.stdout).toContain("Accepted 1");

        // The Brain now serves the lesson over its live search endpoint.
        const res = await fetch(`${url}/v1/search?q=agents`);
        const body = await res.json();
        expect(body.results.length).toBeGreaterThanOrEqual(1);
        expect(body.results[0].status).toBe("trusted");
      });
    });
  });
});
