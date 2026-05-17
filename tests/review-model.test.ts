import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeProject } from "../src/core/context";
import { initProject } from "../src/core/init";
import { buildReviewModel } from "../src/core/review-model";
import { withTempRepo } from "./helpers";

async function addRendererPack(repo: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/renderer-runtime");
  await mkdir(featureDir, { recursive: true });
  await writeFile(
    join(featureDir, "README.md"),
    "# Renderer Runtime\n\nOwns transport clock and frame scheduling behavior.\n",
  );
  await writeFile(join(featureDir, "IDMAP.md"), "# ID Map\n\n- `A0`: renderer runtime\n- `F01`: src/runtime/clock.ts\n");
  await writeFile(join(featureDir, "KG.adj"), "A0 owns transport-clock\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
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
        tags: ["renderer", "clock"],
      },
      {
        id: "RR002",
        subject: "transport clock",
        predicate: "drives",
        object: "frame scheduler",
        src: ["src/runtime/clock.ts", "docs/architecture/rendering.md"],
        status: "active",
        kind: "decision",
        updated_at: "2026-05-17",
      },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

describe("buildReviewModel", () => {
  test("turns context packs and handoffs into inspectable graph data", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await finalizeProject({
        repo,
        status: "success",
        summary: "Updated renderer runtime context.",
        files: ["docs/context/features/renderer-runtime/FACTS.jsonl"],
        tests: ["barry-cache validate"],
      });

      const model = await buildReviewModel({ repo });

      expect(model.summary.features).toBe(1);
      expect(model.summary.facts).toBe(2);
      expect(model.summary.handoffs).toBe(1);
      expect(model.nodes.find((node) => node.id === "feature:renderer-runtime")?.kind).toBe("feature");
      expect(model.nodes.find((node) => node.id === "fact:RR001")?.meta.route).toBe("renderer-runtime");
      expect(model.nodes.find((node) => node.id === "entity:a0")?.label).toBe("A0");
      expect(model.nodes.find((node) => node.id === "source:src/runtime/clock.ts")?.kind).toBe("source");
      expect(model.nodes.some((node) => node.kind === "handoff" && node.label.includes("Updated renderer"))).toBe(true);

      expect(model.edges).toContainEqual(expect.objectContaining({
        source: "feature:renderer-runtime",
        target: "fact:RR001",
        kind: "contains",
      }));
      expect(model.edges).toContainEqual(expect.objectContaining({
        source: "fact:RR002",
        target: "source:src/runtime/clock.ts",
        kind: "cites",
      }));
      expect(new Set(model.nodes.map((node) => node.id)).size).toBe(model.nodes.length);
    });
  });
});
