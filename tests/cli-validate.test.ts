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

async function featureWithMissingSrc(repo: string): Promise<void> {
  const dir = join(repo, "docs/context/features/demo");
  await mkdir(dir, { recursive: true });
  const f = { id: "F-20260601T000000Z-aaaa", subject: "s", predicate: "p", object: "o", src: ["src/core/gone.ts"], status: "active", kind: "implemented", updated_at: "2026-06-18T00:00:00.000Z" };
  await writeFile(join(dir, "FACTS.jsonl"), `${JSON.stringify(f)}\n`);
}

describe("validate --strict", () => {
  test("a drift warning passes by default but fails under --strict", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true, agents: [] });
      await featureWithMissingSrc(repo);

      const lenient = await runCli(repo, ["validate"]);
      expect(lenient.code).toBe(0);
      expect(lenient.stdout).toContain("warning(s)");
      expect(lenient.stdout).toContain("missing source file: src/core/gone.ts");

      const strict = await runCli(repo, ["validate", "--strict"]);
      expect(strict.code).toBe(1);
      expect(strict.stdout).toContain("failing: --strict");
    });
  });
});
