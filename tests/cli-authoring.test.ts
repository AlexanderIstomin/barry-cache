import { describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdr } from "../src/core/adr";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
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

async function addRendererPack(repo: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/renderer-runtime");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), "# Renderer Runtime\n\nOwns runtime scheduling.\n");
  await writeFile(join(featureDir, "IDMAP.md"), "# ID Map\n\n- `F01`: src/runtime/clock.ts\n- `F02`: src/runtime/clock.test.ts\n");
  await writeFile(join(featureDir, "KG.adj"), "renderer-runtime owns transport-clock\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    JSON.stringify({
      id: "RR001",
      subject: "renderer-runtime",
      predicate: "owns",
      object: "transport clock",
      src: ["F01"],
      status: "active",
      kind: "implemented",
      updated_at: "2026-05-17T10:00:00.000Z",
      confidence: "high",
    }) + "\n",
  );
}

describe("authoring cli", () => {
  test("feature new scaffolds a canonical feature pack", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });

      const result = await runCli(repo, [
        "feature",
        "new",
        "--slug",
        "renderer-runtime",
        "--title",
        "Renderer Runtime",
        "--summary",
        "Owns runtime scheduling.",
        "--json",
      ]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.created).toBe(true);
      expect(parsed.route).toBe("renderer-runtime");
      expect(parsed.written).toEqual([
        "docs/context/features/renderer-runtime/README.md",
        "docs/context/features/renderer-runtime/IDMAP.md",
        "docs/context/features/renderer-runtime/KG.adj",
        "docs/context/features/renderer-runtime/FACTS.jsonl",
      ]);

      const readme = await readFile(join(repo, "docs/context/features/renderer-runtime/README.md"), "utf8");
      expect(readme).toContain("# Renderer Runtime");
      expect(readme).toContain("Owns runtime scheduling.");
      expect(await readFile(join(repo, "docs/context/features/renderer-runtime/IDMAP.md"), "utf8")).toContain("# ID Map");
      expect(await readFile(join(repo, "docs/context/features/renderer-runtime/KG.adj"), "utf8")).toBe("");
      expect(await readFile(join(repo, "docs/context/features/renderer-runtime/FACTS.jsonl"), "utf8")).toBe("");

      const validation = await validateProject({ repo });
      expect(validation.ok).toBe(true);
    });
  });

  test("feature new supports dry run without writing files", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });

      const result = await runCli(repo, [
        "feature",
        "new",
        "--slug",
        "dry-run-feature",
        "--title",
        "Dry Run Feature",
        "--summary",
        "Only previews files.",
        "--dry-run",
        "--json",
      ]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.created).toBe(false);
      expect(parsed.dryRun).toBe(true);
      await expect(stat(join(repo, "docs/context/features/dry-run-feature"))).rejects.toThrow();
    });
  });

  test("feature new refuses invalid slugs and existing feature packs", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });

      const invalid = await runCli(repo, [
        "feature",
        "new",
        "--slug",
        "Renderer Runtime",
        "--title",
        "Renderer Runtime",
        "--summary",
        "Owns runtime scheduling.",
      ]);
      expect(invalid.stdout).toBe("");
      expect(invalid.code).toBe(1);
      expect(invalid.stderr).toContain("--slug must use lowercase letters, numbers, and hyphens");

      const first = await runCli(repo, [
        "feature",
        "new",
        "--slug",
        "renderer-runtime",
        "--title",
        "Renderer Runtime",
        "--summary",
        "Owns runtime scheduling.",
      ]);
      expect(first.code).toBe(0);

      const duplicate = await runCli(repo, [
        "feature",
        "new",
        "--slug",
        "renderer-runtime",
        "--title",
        "Renderer Runtime",
        "--summary",
        "Owns runtime scheduling.",
      ]);
      expect(duplicate.stdout).toBe("");
      expect(duplicate.code).toBe(1);
      expect(duplicate.stderr).toContain("Feature pack already exists: renderer-runtime");
    });
  });

  test("fact draft prints a valid JSONL fact without writing", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);

      const result = await runCli(repo, [
        "fact",
        "draft",
        "--route",
        "renderer-runtime",
        "--id",
        "RR002",
        "--subject",
        "renderer-runtime",
        "--predicate",
        "owns",
        "--object",
        "frame scheduler",
        "--src",
        "F01,F02",
        "--tags",
        "runtime,scheduler",
      ]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const fact = JSON.parse(result.stdout);
      expect(fact).toMatchObject({
        id: "RR002",
        subject: "renderer-runtime",
        predicate: "owns",
        object: "frame scheduler",
        src: ["F01", "F02"],
        status: "active",
        kind: "implemented",
        confidence: "high",
        tags: ["runtime", "scheduler"],
      });
      expect(fact.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const facts = await readFile(join(repo, "docs/context/features/renderer-runtime/FACTS.jsonl"), "utf8");
      expect(facts).not.toContain("RR002");
    });
  });

  test("fact draft can append explicitly and generates collision-resistant ids", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);

      const result = await runCli(repo, [
        "fact",
        "draft",
        "--route",
        "renderer-runtime",
        "--prefix",
        "RR",
        "--subject",
        "renderer-runtime",
        "--predicate",
        "tests",
        "--object",
        "clock scheduling contract",
        "--src",
        "F02",
        "--kind",
        "test",
        "--write",
        "--json",
      ]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.written).toBe(true);
      expect(parsed.path).toBe("docs/context/features/renderer-runtime/FACTS.jsonl");
      expect(parsed.fact.id).toMatch(/^RR-\d{8}T\d{6}Z-[a-f0-9]{4}$/);
      expect(parsed.fact.kind).toBe("test");

      const facts = await readFile(join(repo, "docs/context/features/renderer-runtime/FACTS.jsonl"), "utf8");
      expect(facts).toContain(parsed.fact.id);
      const validation = await validateProject({ repo });
      expect(validation.ok).toBe(true);
    });
  });

  test("fact draft refuses missing routes, unresolved source ids, and duplicate fact ids", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);

      const missingRoute = await runCli(repo, [
        "fact",
        "draft",
        "--route",
        "missing-route",
        "--id",
        "RR002",
        "--subject",
        "renderer-runtime",
        "--predicate",
        "owns",
        "--object",
        "frame scheduler",
        "--src",
        "F01",
      ]);
      expect(missingRoute.stdout).toBe("");
      expect(missingRoute.code).toBe(1);
      expect(missingRoute.stderr).toContain("Feature pack not found: missing-route");

      const missingSource = await runCli(repo, [
        "fact",
        "draft",
        "--route",
        "renderer-runtime",
        "--id",
        "RR002",
        "--subject",
        "renderer-runtime",
        "--predicate",
        "owns",
        "--object",
        "frame scheduler",
        "--src",
        "MISSING_SOURCE",
      ]);
      expect(missingSource.stdout).toBe("");
      expect(missingSource.code).toBe(1);
      expect(missingSource.stderr).toContain("fact references unknown source id: MISSING_SOURCE");

      const duplicate = await runCli(repo, [
        "fact",
        "draft",
        "--route",
        "renderer-runtime",
        "--id",
        "RR001",
        "--subject",
        "renderer-runtime",
        "--predicate",
        "owns",
        "--object",
        "frame scheduler",
        "--src",
        "F01",
        "--write",
      ]);
      expect(duplicate.stdout).toBe("");
      expect(duplicate.code).toBe(1);
      expect(duplicate.stderr).toContain("Fact id already exists in renderer-runtime: RR001");
    });
  });

  test("fact draft accepts ADR ids as sources without IDMAP entries", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      const adr = await createAdr({ repo, title: "Use ADR id source" });

      const result = await runCli(repo, [
        "fact",
        "draft",
        "--route",
        "renderer-runtime",
        "--id",
        "RR003",
        "--subject",
        "renderer-runtime",
        "--predicate",
        "follows",
        "--object",
        "ADR-backed scheduling decision",
        "--src",
        adr.id,
      ]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      const fact = JSON.parse(result.stdout);
      expect(fact.src).toEqual(["ADR-0001"]);
    });
  });
});
