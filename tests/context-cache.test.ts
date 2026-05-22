import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeTask } from "../src/core/context";
import { initProject } from "../src/core/init";
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

describe("context cache", () => {
  test("persists and reuses a parsed context snapshot while source files are fresh", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);

      const first = await routeTask({ repo, task: "transport clock" });
      expect(first.routes[0]?.slug).toBe("renderer-runtime");

      const cachePath = join(repo, ".context-cache/context-index.json");
      const cache = JSON.parse(await readFile(cachePath, "utf8"));
      expect(cache.version).toBe(1);
      expect(cache.features[0]?.slug).toBe("renderer-runtime");

      cache.features[0].readme += "\ncachephantom\n";
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

      const cached = await routeTask({ repo, task: "cachephantom" });
      expect(cached.routes[0]?.slug).toBe("renderer-runtime");
    });
  });

  test("invalidates the parsed context snapshot when source files change", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await routeTask({ repo, task: "transport clock" });

      const cachePath = join(repo, ".context-cache/context-index.json");
      const cache = JSON.parse(await readFile(cachePath, "utf8"));
      cache.features[0].readme += "\ncachephantom\n";
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

      await writeFile(
        join(repo, "docs/context/features/renderer-runtime/README.md"),
        "# Renderer Runtime\n\nOwns diskfresh behavior.\n",
      );

      const refreshed = await routeTask({ repo, task: "diskfresh" });
      expect(refreshed.routes[0]?.slug).toBe("renderer-runtime");

      const stale = await routeTask({ repo, task: "cachephantom" });
      expect(stale.routes).toHaveLength(0);
    });
  });
});
