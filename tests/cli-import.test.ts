import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/core/init";
import { withTempRepo } from "./helpers";

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(thisDir, "../src/cli.ts");

async function addPulpcutKb(repo: string): Promise<void> {
  await mkdir(join(repo, "docs/templates"), { recursive: true });
  await writeFile(
    join(repo, "docs/KB_INDEX.md"),
    `# KB Index

## Primary Router
- \`templates\`
  - Use for: template publish and clone behavior.
`,
  );
  await writeFile(join(repo, "docs/templates/IDMAP.md"), "# Templates KB ID Map\n\n## File IDs\n- `F01` = `src/templates.ts`\n\n## Entity IDs\n- `A0` = Templates feature\n");
  await writeFile(join(repo, "docs/templates/KG.adj"), "A0 owns F01\n");
  await writeFile(
    join(repo, "docs/templates/FACTS.jsonl"),
    JSON.stringify({ id: "AF001", s: "A0", p: "owns", o: "template publish flow", src: ["F01"] }) + "\n",
  );
}

describe("import cli", () => {
  test("imports a PulpCut KB source with json output", async () => {
    await withTempRepo(async (targetRepo) => {
      await withTempRepo(async (sourceRepo) => {
        await initProject({ repo: targetRepo, yes: true });
        await addPulpcutKb(sourceRepo);

        const proc = Bun.spawn([process.execPath, cliPath, "import", "--source", "pulpcut-kb", "--from", sourceRepo, "--json"], {
          cwd: targetRepo,
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const code = await proc.exited;

        expect(stderr).toBe("");
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.imported).toBe(1);
        expect(result.features).toContain("templates");

        const facts = await readFile(join(targetRepo, "docs/context/features/templates/FACTS.jsonl"), "utf8");
        expect(facts).toContain("\"subject\":\"A0\"");
      });
    });
  });
});
