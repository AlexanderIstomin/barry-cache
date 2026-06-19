import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withTempRepo } from "./helpers";

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

  test("kb propose --kind decision_pattern carries the taxonomy", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      const result = await runCli(repo, [...proposeArgs, "--kind", "decision_pattern", "--dry-run", "--json"]);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).lesson.kind).toBe("decision_pattern");
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

  test("kb harvest --source context drafts candidates from existing decision facts", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "sharing", "set", "preview-only"]);
      const featDir = join(repo, "docs/context/features/demo");
      await mkdir(featDir, { recursive: true });
      await writeFile(join(featDir, "FACTS.jsonl"), `${JSON.stringify({ id: "D1", subject: "Signed intake batches", predicate: "bind", object: "the full payload via recursive stable stringify", src: ["X"], status: "active", kind: "decision", updated_at: "2026-06-18T00:00:00.000Z" })}\n`);

      const result = await runCli(repo, ["kb", "harvest", "--source", "context"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("kb propose lesson --kind decision_pattern");
      expect(result.stdout.toLowerCase()).toContain("anonymize");
    });
  });

  test("kb harvest --source context is blocked in local-only mode", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "harvest", "--source", "context"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("preview-only or share-enabled");
    });
  });
});

describe("kb search --source cq", () => {
  test("returns mapped cq results from a configured cq endpoint", async () => {
    await withTempRepo(async (repo) => {
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response(JSON.stringify({
          data: [{ id: "ku_x", domains: ["ci"], evidence: { confidence: 0.8 }, insight: { summary: "flaky ci", detail: "tests flake", action: "retry" } }],
        }), { status: 200 }),
      });
      try {
        await mkdir(join(repo, ".barry-cache"), { recursive: true });
        await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({
          shared_kb: { contribution: "share_enabled", cq: { url: `http://127.0.0.1:${server.port}` } },
        }));
        const result = await runCli(repo, ["kb", "search", "--source", "cq", "--query", "flaky", "--domains", "ci", "--json"]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).results[0].id).toBe("ku_x");
      } finally {
        server.stop(true);
      }
    });
  });

  test("requires at least one domain", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, ".barry-cache"), { recursive: true });
      await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({ shared_kb: { contribution: "share_enabled", cq: { url: "https://api.cq.exchange" } } }));
      const result = await runCli(repo, ["kb", "search", "--source", "cq", "--query", "x"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("requires at least one domain");
    });
  });

  test("requires share-enabled mode", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, ".barry-cache"), { recursive: true });
      await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({
        shared_kb: { contribution: "preview_only", cq: { url: "https://cq.example.com" } },
      }));
      const result = await runCli(repo, ["kb", "search", "--source", "cq", "--query", "x"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("share-enabled");
    });
  });

  test("rejects a non-cq source", async () => {
    await withTempRepo(async (repo) => {
      const result = await runCli(repo, ["kb", "search", "--source", "https://example.com/pack", "--query", "x"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("only supports --source cq");
    });
  });
});

describe("kb contribute", () => {
  test("maps queued lessons to cq propose requests and POSTs them", async () => {
    await withTempRepo(async (repo) => {
      const received: any[] = [];
      const server = Bun.serve({
        port: 0,
        fetch: async (req) => { received.push(await req.json()); return new Response(JSON.stringify({ data: { id: "ku_" + "a".repeat(32) } }), { status: 201 }); },
      });
      try {
        await mkdir(join(repo, ".barry-cache"), { recursive: true });
        await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({
          shared_kb: { contribution: "share_enabled", cq: { url: `http://127.0.0.1:${server.port}` } },
        }));
        expect((await runCli(repo, proposeArgs)).code).toBe(0);
        const result = await runCli(repo, ["kb", "contribute", "--json"]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).contributed).toBe(1);
        expect(received[0].insight.summary).toBe("Treat handoffs as claims until validated");
        expect(received[0].domains).toEqual(["agents", "validation"]);
        expect(received[0].insight.detail).toContain("Source: Barry Cache lesson");
      } finally { server.stop(true); }
    });
  });

  test("requires share-enabled mode", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, ".barry-cache"), { recursive: true });
      await writeFile(join(repo, ".barry-cache/config.json"), JSON.stringify({ shared_kb: { contribution: "preview_only", cq: { url: "https://cq.example.com" } } }));
      const result = await runCli(repo, ["kb", "contribute"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("share-enabled");
    });
  });
});

describe("kb cq login", () => {
  test("stores the key + endpoint, enables sharing, and search uses the stored key", async () => {
    await withTempRepo(async (repo) => {
      const captured: { auth: string | null } = { auth: null };
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          captured.auth = new Headers(req.headers).get("authorization");
          return new Response(JSON.stringify({ data: [{ id: "ku_x", domains: ["ci"], evidence: { confidence: 0.8 }, insight: { summary: "flaky ci", detail: "tests flake", action: "retry" } }] }), { status: 200 });
        },
      });
      try {
        const login = await runCli(repo, ["kb", "cq", "login", "--api-key", "secret-key", "--url", `http://127.0.0.1:${server.port}`]);
        expect(login.stderr).toBe("");
        expect(login.code).toBe(0);
        expect(login.stdout).toContain("Connected to cq");

        const cfg = JSON.parse(await readFile(join(repo, ".barry-cache/config.json"), "utf8"));
        expect(cfg.shared_kb.contribution).toBe("share_enabled");
        expect(cfg.shared_kb.cq.url).toBe(`http://127.0.0.1:${server.port}`);
        const creds = JSON.parse(await readFile(join(repo, ".barry-cache/cq-credentials.json"), "utf8"));
        expect(creds.api_key).toBe("secret-key");

        const search = await runCli(repo, ["kb", "search", "--source", "cq", "--query", "flaky", "--domains", "ci", "--json"]);
        expect(search.code).toBe(0);
        expect(captured.auth).toBe("Bearer secret-key");
      } finally {
        server.stop(true);
      }
    });
  });

  test("logout removes the key and sets local-only", async () => {
    await withTempRepo(async (repo) => {
      await runCli(repo, ["kb", "cq", "login", "--api-key", "k", "--url", "https://cq.example.com"]);
      const out = await runCli(repo, ["kb", "cq", "logout"]);
      expect(out.code).toBe(0);
      expect(out.stdout).toContain("local-only");
      const cfg = JSON.parse(await readFile(join(repo, ".barry-cache/config.json"), "utf8"));
      expect(cfg.shared_kb.contribution).toBe("local_only");
      await expect(readFile(join(repo, ".barry-cache/cq-credentials.json"), "utf8")).rejects.toThrow();
    });
  });
});
