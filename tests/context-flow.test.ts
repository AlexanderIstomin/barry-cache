import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeProject, loadContext, recordValidationFailure, resumeProject, routeTask, searchContext } from "../src/core/context";
import { initProject } from "../src/core/init";
import { validateProject } from "../src/core/validate";
import { withTempRepo } from "./helpers";

async function addRendererPack(repo: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/renderer-runtime");
  await mkdir(featureDir, { recursive: true });
  await writeFile(
    join(featureDir, "README.md"),
    "# Renderer Runtime\n\nOwns the transport clock and frame scheduling behavior.\n",
  );
  await writeFile(
    join(featureDir, "IDMAP.md"),
    "# ID Map\n\n- `A0`: renderer runtime\n- `F01`: src/runtime/clock.ts\n",
  );
  await writeFile(join(featureDir, "KG.adj"), "A0 owns transport-clock\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    JSON.stringify({
      id: "RR001",
      subject: "A0",
      predicate: "owns",
      object: "transport clock",
      src: ["F01"],
      status: "active",
      kind: "implemented",
      updated_at: "2026-05-17",
      tags: ["renderer", "clock"],
    }) + "\n",
  );
}

describe("context flow", () => {
  test("routes, searches, loads, resumes, and finalizes context", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);

      const route = await routeTask({ repo, task: "fix renderer transport clock drift" });
      expect(route.routes[0]?.slug).toBe("renderer-runtime");
      expect(route.routes[0]?.score).toBeGreaterThan(0);

      const search = await searchContext({ repo, query: "transport clock" });
      expect(search.results.some((item) => item.id === "RR001")).toBe(true);

      const loaded = await loadContext({ repo, route: "renderer-runtime" });
      expect(loaded.feature?.slug).toBe("renderer-runtime");
      expect(loaded.facts[0]?.id).toBe("RR001");

      const resume = await resumeProject({ repo, task: "fix renderer transport clock drift" });
      expect(resume.execution_contract.first_action).toContain("renderer-runtime");
      expect(resume.context.routes[0]?.slug).toBe("renderer-runtime");

      const finalize = await finalizeProject({
        repo,
        status: "success",
        summary: "Updated renderer clock context.",
        files: ["docs/context/features/renderer-runtime/FACTS.jsonl"],
        tests: ["barry-cache validate"],
      });
      expect(finalize.saved).toBe(true);
      expect(finalize.id).toStartWith("handoff-");

      const handoffs = await readFile(join(repo, ".context-state/handoffs/handoffs.jsonl"), "utf8");
      expect(handoffs).toContain("Updated renderer clock context.");

      const failure = await recordValidationFailure({
        repo,
        summary: "User reported that renderer clock drift still reproduces after the handoff.",
        expected: "Renderer clock remains aligned after scheduling updates.",
        actual: "Renderer clock still drifts during playback.",
        challenges: [finalize.id],
        files: ["src/runtime/clock.ts"],
      });
      expect(failure.saved).toBe(true);
      expect(failure.id).toStartWith("failure-");

      const failures = await readFile(join(repo, ".context-state/failures/failures.jsonl"), "utf8");
      expect(failures).toContain("\"kind\":\"validation_failure\"");
      expect(failures).toContain("\"status\":\"open\"");
      expect(failures).toContain(finalize.id);
      expect(failures).toContain("Renderer clock still drifts during playback.");
    });
  });

  test("validation reports invalid fact rows with file and line", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await writeFile(join(repo, "docs/context/features/renderer-runtime/FACTS.jsonl"), "{\"id\":\"BROKEN\"}\n");

      const validation = await validateProject({ repo });

      expect(validation.ok).toBe(false);
      expect(validation.errors[0]?.file).toBe("docs/context/features/renderer-runtime/FACTS.jsonl");
      expect(validation.errors[0]?.line).toBe(1);
      expect(validation.errors[0]?.message).toContain("subject");
    });
  });

  test("validation rejects malformed fact metadata and duplicate feature fact ids", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await writeFile(
        join(repo, "docs/context/features/renderer-runtime/FACTS.jsonl"),
        [
          {
            id: "RR001",
            subject: "A0",
            predicate: "owns",
            object: "transport clock",
            src: ["F01"],
            status: "active",
            kind: "implemented",
            updated_at: "2026-05-17",
            confidence: "high",
          },
          {
            id: "RR001",
            subject: "A0",
            predicate: "owns",
            object: "frame scheduler",
            src: ["F01"],
            status: "draft",
            kind: "implementation",
            updated_at: "yesterday",
            confidence: "certain",
          },
        ].map((row) => JSON.stringify(row)).join("\n") + "\n",
      );

      const validation = await validateProject({ repo });

      expect(validation.ok).toBe(false);
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/FACTS.jsonl",
        line: 2,
        message: "duplicate fact id in feature pack: RR001",
      }));
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/FACTS.jsonl",
        line: 2,
        message: "invalid field: status",
      }));
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/FACTS.jsonl",
        line: 2,
        message: "invalid field: kind",
      }));
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/FACTS.jsonl",
        line: 2,
        message: "invalid field: updated_at",
      }));
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/FACTS.jsonl",
        line: 2,
        message: "invalid field: confidence",
      }));
    });
  });

  test("validation reports malformed ID maps, graph rows, and unresolved source ids", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await writeFile(
        join(repo, "docs/context/features/renderer-runtime/IDMAP.md"),
        "# ID Map\n\n- `F01`: src/runtime/clock.ts\n- `BROKEN` src/runtime/broken.ts\n",
      );
      await writeFile(join(repo, "docs/context/features/renderer-runtime/KG.adj"), "A0 owns transport-clock\nbroken-edge\n");
      await writeFile(
        join(repo, "docs/context/features/renderer-runtime/FACTS.jsonl"),
        JSON.stringify({
          id: "RR002",
          subject: "A0",
          predicate: "owns",
          object: "frame scheduler",
          src: ["MISSING_SOURCE"],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-18T10:15:00.000Z",
        }) + "\n",
      );

      const validation = await validateProject({ repo });

      expect(validation.ok).toBe(false);
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/IDMAP.md",
        line: 4,
        message: "invalid ID map entry",
      }));
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/KG.adj",
        line: 2,
        message: "invalid graph row",
      }));
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/features/renderer-runtime/FACTS.jsonl",
        line: 1,
        message: "fact references unknown source id: MISSING_SOURCE",
      }));
    });
  });
});
