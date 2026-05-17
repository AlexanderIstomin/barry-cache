import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadContext } from "../src/core/context";
import { importPulpcutKb } from "../src/core/import-pulpcut";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
import { withTempRepo } from "./helpers";

async function addPulpcutKb(repo: string): Promise<void> {
  await mkdir(join(repo, "docs/editor-media-runtime"), { recursive: true });
  await writeFile(
    join(repo, "docs/KB_INDEX.md"),
    `# KB Index

## Primary Router
- \`editor-media-runtime\`
  - Use for: preview playback/runtime and export runtime.
  - Add: \`audio-enhancement\` for Improve voice.
`,
  );
  await writeFile(
    join(repo, "docs/editor-media-runtime/IDMAP.md"),
    `# Editor Media Runtime KB ID Map

## Scope
- This KB documents preview playback and export runtime.

## File IDs
- \`F01\` = \`src/runtime.ts\`
- \`F02\` = \`src/runtime.test.ts\`

## Entity IDs
- \`A0\` = Editor media runtime feature
- \`U1\` = Runtime manager
- \`D1\` = Runtime contract

## Predicate vocabulary
- rule
- verifies

## Notes
- Imported from PulpCut.
`,
  );
  await writeFile(
    join(repo, "docs/editor-media-runtime/KG.adj"),
    "A0 owns D1\nU1 defines D1\nD1 -> F01 [defined-in]\n",
  );
  await writeFile(
    join(repo, "docs/editor-media-runtime/FACTS.jsonl"),
    [
      { id: "AF001", s: "U1", p: "rule", o: "runtime audio follows video playback", src: ["F01"] },
      { id: "AF002", s: "D1", p: "verifies", o: "runtime contract has coverage", src: ["F02"], corrects: "AF000" },
      { id: "AF003", s: "D1", p: "enum", o: ["linear", "step"], src: ["F01"] },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

describe("importPulpcutKb", () => {
  test("imports old PulpCut KB folders into Barry feature packs", async () => {
    await withTempRepo(async (targetRepo) => {
      await withTempRepo(async (sourceRepo) => {
        await initProject({ repo: targetRepo, yes: true });
        await addPulpcutKb(sourceRepo);

        const result = await importPulpcutKb({ repo: targetRepo, from: sourceRepo });

        expect(result.imported).toBe(1);
        expect(result.features).toContain("editor-media-runtime");
        expect(result.written).toContain("docs/context/features/editor-media-runtime/FACTS.jsonl");
        expect(result.warnings).toEqual([]);

        const loaded = await loadContext({ repo: targetRepo, route: "editor-media-runtime" });
        expect(loaded.feature?.readme).toContain("preview playback/runtime and export runtime");
        expect(loaded.facts[0]).toMatchObject({
          id: "AF001",
          subject: "U1",
          predicate: "rule",
          object: "runtime audio follows video playback",
          status: "active",
          kind: "constraint",
          confidence: "high",
        });
        expect(loaded.facts[1]?.supersedes).toBe("AF000");
        expect(loaded.facts[2]?.object).toBe("[\"linear\",\"step\"]");

        const idmap = await readFile(join(targetRepo, "docs/context/features/editor-media-runtime/IDMAP.md"), "utf8");
        expect(idmap).toContain("`F01` = `src/runtime.ts`");

        const validation = await validateProject({ repo: targetRepo });
        expect(validation.ok).toBe(true);
      });
    });
  });

  test("dry run reports planned writes without importing files", async () => {
    await withTempRepo(async (targetRepo) => {
      await withTempRepo(async (sourceRepo) => {
        await initProject({ repo: targetRepo, yes: true });
        await addPulpcutKb(sourceRepo);

        const result = await importPulpcutKb({ repo: targetRepo, from: sourceRepo, dryRun: true });

        expect(result.dryRun).toBe(true);
        expect(result.imported).toBe(1);
        await expect(readFile(join(targetRepo, "docs/context/features/editor-media-runtime/FACTS.jsonl"), "utf8")).rejects.toThrow();
      });
    });
  });
});
