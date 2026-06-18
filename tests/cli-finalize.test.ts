import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

describe("finalize cli", () => {
  test("plain output distinguishes operational handoff from canonical memory", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: ["codex"] });

      const proc = Bun.spawn([process.execPath, cliPath, "finalize", "--status", "success", "--summary", "Added transcript checkbox."], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("Saved operational handoff to .context-state/handoffs/handoffs.jsonl.");
      expect(stdout).toContain("Finalize writes operational memory only; it does not update canonical context in docs/context/.");
      expect(stdout).toContain("If this task introduced durable implementation behavior, add or update docs/context/features/*/FACTS.jsonl and run barry-cache validate.");
    });
  });

  test("nudges harvest after a successful finalize only when sharing is enabled", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: ["codex"] });

      const run = async (args: string[]) => {
        const proc = Bun.spawn([process.execPath, cliPath, ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
        const stdout = await new Response(proc.stdout).text();
        await proc.exited;
        return stdout;
      };

      const localOnly = await run(["finalize", "--status", "success", "--summary", "Did the thing."]);
      expect(localOnly).not.toContain("kb harvest");

      await run(["kb", "sharing", "set", "preview-only"]);
      const shared = await run(["finalize", "--status", "success", "--summary", "Did the thing."]);
      expect(shared).toContain("barry-cache kb harvest");
    });
  });

  test("records validation failures and lets follow-up handoffs link fixes", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: ["codex"] });

      const failureProc = Bun.spawn([
        process.execPath,
        cliPath,
        "failure",
        "record",
        "--summary",
        "User reported that transcript export still fails.",
        "--expected",
        "Transcript export completes.",
        "--actual",
        "Export button does nothing.",
        "--challenges",
        "handoff-previous",
        "--files",
        "src/export.ts,tests/export.test.ts",
        "--json",
      ], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const failureStdout = await new Response(failureProc.stdout).text();
      const failureStderr = await new Response(failureProc.stderr).text();
      const failureCode = await failureProc.exited;

      expect(failureStderr).toBe("");
      expect(failureCode).toBe(0);
      const failure = JSON.parse(failureStdout) as { id: string; saved: boolean };
      expect(failure.saved).toBe(true);
      expect(failure.id).toStartWith("failure-");

      const finalizeProc = Bun.spawn([
        process.execPath,
        cliPath,
        "finalize",
        "--status",
        "success",
        "--summary",
        "Fixed transcript export after user validation failure.",
        "--fixes",
        failure.id,
        "--files",
        "src/export.ts",
        "--json",
      ], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      const finalizeStdout = await new Response(finalizeProc.stdout).text();
      const finalizeStderr = await new Response(finalizeProc.stderr).text();
      const finalizeCode = await finalizeProc.exited;

      expect(finalizeStderr).toBe("");
      expect(finalizeCode).toBe(0);
      const finalize = JSON.parse(finalizeStdout) as { saved: boolean; id: string };
      expect(finalize.saved).toBe(true);
      expect(finalize.id).toStartWith("handoff-");

      const failureRows = await readFile(join(repo, ".context-state/failures/failures.jsonl"), "utf8");
      expect(failureRows).toContain("\"expected\":\"Transcript export completes.\"");
      expect(failureRows).toContain("\"actual\":\"Export button does nothing.\"");
      expect(failureRows).toContain("\"challenges\":[\"handoff-previous\"]");

      const handoffRows = await readFile(join(repo, ".context-state/handoffs/handoffs.jsonl"), "utf8");
      expect(handoffRows).toContain(`"fixes":["${failure.id}"]`);
      expect(handoffRows).toContain("\"files\":[\"src/export.ts\"]");
    });
  });
});
