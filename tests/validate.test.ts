import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
import { withTempRepo } from "./helpers";

const NOW = new Date("2026-06-19T00:00:00.000Z");

function fact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "F-20260601T000000Z-aaaa",
    subject: "s",
    predicate: "p",
    object: "o",
    src: ["docs/context/README.md"],
    status: "active",
    kind: "implemented",
    updated_at: "2026-06-18T00:00:00.000Z",
    ...over,
  };
}

async function scaffold(repo: string): Promise<void> {
  await initProject({ repo, yes: true, agents: [] });
}

async function writeFeature(repo: string, slug: string, facts: Record<string, unknown>[], idmap?: string): Promise<void> {
  const dir = join(repo, "docs/context/features", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "FACTS.jsonl"), `${facts.map((f) => JSON.stringify(f)).join("\n")}\n`);
  if (idmap) await writeFile(join(dir, "IDMAP.md"), idmap);
}

describe("validate drift detection", () => {
  test("warns (without failing) when a fact src path points to a missing file", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["src/core/gone.ts"] })]);
      const result = await validateProject({ repo, now: NOW });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("missing source file") && w.message.includes("src/core/gone.ts"))).toBe(true);
    });
  });

  test("resolves IDMAP tokens and warns on a missing target", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["GONE"] })], "- `GONE`: src/core/gone.ts\n- `OK`: docs/context/README.md\n");
      const result = await validateProject({ repo, now: NOW });
      expect(result.warnings.some((w) => w.message.includes("missing source file") && w.message.includes("GONE"))).toBe(true);
    });
  });

  test("does not warn when src resolves to an existing file or IDMAP token", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["OK"] })], "- `OK`: docs/context/README.md\n");
      const result = await validateProject({ repo, now: NOW });
      expect(result.warnings.some((w) => w.message.includes("missing source file"))).toBe(false);
    });
  });

  test("warns when a src resolves outside the repo instead of silently statting it", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["../escape.ts"] })]);
      const result = await validateProject({ repo, now: NOW });
      expect(result.warnings.some((w) => w.message.includes("outside the repo") && w.message.includes("../escape.ts"))).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("missing source file"))).toBe(false);
    });
  });

  test("treats a backslash path as path-like so drift detection works cross-platform", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["src\\core\\gone.ts"] })]);
      const result = await validateProject({ repo, now: NOW });
      expect(result.warnings.some((w) => w.message.includes("missing source file"))).toBe(true);
    });
  });

  test("resolves indented and '=' separated IDMAP entries for drift, matching validateIdMap", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["GONE"] })], "  - `GONE` = src/core/gone.ts\n");
      const result = await validateProject({ repo, now: NOW });
      // The entry must not be flagged as an unknown source id (validateIdMap accepts it) ...
      expect(result.errors.some((e) => e.message.includes("unknown source id"))).toBe(false);
      // ... and drift detection must resolve the same entry and warn on its missing target.
      expect(result.warnings.some((w) => w.message.includes("missing source file") && w.message.includes("GONE"))).toBe(true);
    });
  });

  test("resolves a code-span (backtick-wrapped) IDMAP path so an existing target does not warn", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      // Markdown convention used by real feature packs: the path is itself a code span.
      await writeFeature(repo, "demo", [fact({ src: ["OK"] })], "- `OK` = `docs/context/README.md`\n");
      const result = await validateProject({ repo, now: NOW });
      expect(result.warnings.some((w) => w.message.includes("missing source file"))).toBe(false);
    });
  });

  test("takes the first code span as the path when an IDMAP value carries trailing prose", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [fact({ src: ["GONE"] })], "- `GONE` = `src/core/gone.ts` (renderer entry; seed file)\n");
      const result = await validateProject({ repo, now: NOW });
      expect(result.warnings.some((w) => w.message.includes("missing source file") && w.message.includes("src/core/gone.ts"))).toBe(true);
    });
  });

  test("warns about an aged open-question/risk fact but not a recent one", async () => {
    await withTempRepo(async (repo) => {
      await scaffold(repo);
      await writeFeature(repo, "demo", [
        fact({ id: "F-20250101T000000Z-old1", kind: "open-question", updated_at: "2025-01-01T00:00:00.000Z" }),
        fact({ id: "F-20260601T000000Z-new1", kind: "risk", updated_at: "2026-06-01T00:00:00.000Z" }),
      ]);
      const result = await validateProject({ repo, now: NOW, staleAfterDays: 180 });
      expect(result.warnings.some((w) => w.message.includes("open-question") && w.message.includes("F-20250101T000000Z-old1"))).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("F-20260601T000000Z-new1"))).toBe(false);
    });
  });
});
