import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function addRendererPack(repo: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/renderer-runtime");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), "# Renderer Runtime\n\nOwns playback runtime behavior.\n");
  await writeFile(join(featureDir, "IDMAP.md"), "- `F01`: src/runtime/clock.ts\n- `F02`: src/runtime/scheduler.ts\n");
  await writeFile(join(featureDir, "KG.adj"), "renderer-runtime owns playback-runtime\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    [
      {
        id: "RR001",
        subject: "renderer runtime",
        predicate: "owns",
        object: "transport clock",
        src: ["F01"],
        status: "active",
        kind: "implemented",
        updated_at: "2026-05-17",
      },
      {
        id: "RR002",
        subject: "transport clock",
        predicate: "drives",
        object: "frame scheduler",
        src: ["F02"],
        status: "active",
        kind: "implemented",
        updated_at: "2026-05-19",
      },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function runBarry(repo: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("changelog cli", () => {
  test("prints markdown changelog without writing a file", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);

      const result = await runBarry(repo, ["changelog"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("# Changelog");
      expect(result.stdout).toContain("## 2026-05-17");
      expect(result.stdout).toContain("### Renderer Runtime");
      expect(result.stdout).toContain("- renderer runtime owns transport clock");
      await expect(readFile(join(repo, "CHANGELOG.md"), "utf8")).rejects.toThrow();
    });
  });

  test("refuses to overwrite an existing changelog without rewrite", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await writeFile(join(repo, "CHANGELOG.md"), "# Existing Changelog\n\nKeep this.\n");

      const result = await runBarry(repo, ["changelog", "--write"]);
      const current = await readFile(join(repo, "CHANGELOG.md"), "utf8");

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("CHANGELOG.md already exists.");
      expect(result.stderr).toContain("Use --rewrite to replace it.");
      expect(result.stderr).toContain("Use --write --since YYYY-MM-DD to append filtered entries.");
      expect(current).toBe("# Existing Changelog\n\nKeep this.\n");
    });
  });

  test("appends a since-filtered diff to an existing changelog", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await writeFile(join(repo, "CHANGELOG.md"), "# Existing Changelog\n\nKeep this.\n");

      const sinceWrite = await runBarry(repo, ["changelog", "--write", "--since", "2026-05-18"]);
      const appended = await readFile(join(repo, "CHANGELOG.md"), "utf8");

      expect(sinceWrite.code).toBe(0);
      expect(sinceWrite.stderr).toBe("");
      expect(sinceWrite.stdout).toContain("Appended changelog at CHANGELOG.md.");
      expect(appended).toStartWith("# Existing Changelog\n\nKeep this.\n\n## 2026-05-19");
      expect(appended).toContain("- transport clock drives frame scheduler");
      expect(appended).not.toContain("- renderer runtime owns transport clock");
      expect(appended).not.toContain("# Changelog\n\n## 2026-05-19");

      const sincePreview = await runBarry(repo, ["changelog", "--since", "2026-05-18"]);

      expect(sincePreview.stderr).toBe("");
      expect(sincePreview.code).toBe(0);
      expect(sincePreview.stdout).toContain("## 2026-05-19");
      expect(sincePreview.stdout).toContain("- transport clock drives frame scheduler");
      expect(sincePreview.stdout).not.toContain("- renderer runtime owns transport clock");

      const bothFlags = await runBarry(repo, ["changelog", "--write", "--rewrite"]);

      expect(bothFlags.code).toBe(1);
      expect(bothFlags.stdout).toBe("");
      expect(bothFlags.stderr).toContain("Use either --write or --rewrite, not both.");

      const rewrite = await runBarry(repo, ["changelog", "--rewrite"]);
      const rewritten = await readFile(join(repo, "CHANGELOG.md"), "utf8");

      expect(rewrite.stderr).toBe("");
      expect(rewrite.code).toBe(0);
      expect(rewritten).toContain("- renderer runtime owns transport clock");
      expect(rewritten).toContain("- transport clock drives frame scheduler");
      expect(rewritten).not.toContain("Keep this.");
      expect(rewritten).not.toContain("barry-changelog");
    });
  });
});
