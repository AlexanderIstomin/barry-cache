import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initProject } from "../src/core/init";
import { createReviewHtml, startReviewServer } from "../src/core/review-server";
import { withTempRepo } from "./helpers";

async function addPack(repo: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/search-index");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), "# Search Index\n\nOwns query retrieval.\n");
  await writeFile(join(featureDir, "IDMAP.md"), "- `F01`: src/search/index.ts\n");
  await writeFile(join(featureDir, "KG.adj"), "search-index owns retrieval\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    JSON.stringify({
      id: "SI001",
      subject: "search-index",
      predicate: "owns",
      object: "query retrieval",
      src: ["F01"],
      status: "active",
      kind: "implemented",
      updated_at: "2026-05-17",
    }) + "\n",
  );
}

describe("review server", () => {
  test("serves the app shell and review model api", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addPack(repo);

      expect(createReviewHtml()).toContain("/api/model");

      const server = await startReviewServer({ repo, port: 0, open: false });
      try {
        const response = await fetch(`${server.url}/api/model`);
        expect(response.status).toBe(200);
        const model = await response.json();
        expect(model.summary.features).toBe(1);
        expect(model.nodes.some((node: { id: string }) => node.id === "feature:search-index")).toBe(true);
      } finally {
        await server.close();
      }
    });
  });
});
