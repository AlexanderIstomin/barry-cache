import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdr, listAdrs } from "../src/core/adr";
import { loadContext, routeTask, searchContext } from "../src/core/context";
import { initProject } from "../src/core/init";
import { buildReviewModel } from "../src/core/review-model";
import { validateProject } from "../src/core/validate";
import { withTempRepo } from "./helpers";

async function addContextPack(repo: string, adrPath: string): Promise<void> {
  const featureDir = join(repo, "docs/context/features/context-memory");
  await mkdir(featureDir, { recursive: true });
  await writeFile(
    join(featureDir, "README.md"),
    "# Context Memory\n\nKeeps canonical project memory available to agents.\n",
  );
  await writeFile(join(featureDir, "IDMAP.md"), "# ID Map\n");
  await writeFile(join(featureDir, "KG.adj"), "Barry owns context-memory\n");
  await writeFile(
    join(featureDir, "FACTS.jsonl"),
    JSON.stringify({
      id: "CTX001",
      subject: "Barry",
      predicate: "stores canonical context in",
      object: "docs/context/",
      src: [adrPath],
      status: "active",
      kind: "decision",
      updated_at: "2026-05-19",
    }) + "\n",
  );
}

describe("ADR support", () => {
  test("creates sequential ADR files and lists their metadata", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });

      const first = await createAdr({
        repo,
        title: "Use repo-native context",
        tags: ["context", "agents"],
      });
      const second = await createAdr({ repo, title: "Keep generated indexes disposable" });

      expect(first).toEqual(expect.objectContaining({
        id: "ADR-0001",
        path: "docs/context/adrs/ADR-0001-use-repo-native-context.md",
        status: "active",
      }));
      expect(second.id).toBe("ADR-0002");

      const content = await readFile(join(repo, first.path), "utf8");
      expect(content).toContain("id: ADR-0001");
      expect(content).toContain("title: Use repo-native context");
      expect(content).toContain("tags: [context, agents]");
      expect(content).toContain("## Decision");

      const adrs = await listAdrs({ repo });
      expect(adrs.map((adr) => adr.id)).toEqual(["ADR-0001", "ADR-0002"]);
      expect(adrs[0]).toEqual(expect.objectContaining({
        title: "Use repo-native context",
        path: "docs/context/adrs/ADR-0001-use-repo-native-context.md",
        tags: ["context", "agents"],
      }));
    });
  });

  test("searches ADRs and loads ADRs linked from feature facts", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const adr = await createAdr({ repo, title: "Use repo-native canonical context" });
      await addContextPack(repo, adr.path);

      const search = await searchContext({ repo, query: "repo-native canonical context" });
      expect(search.results).toContainEqual(expect.objectContaining({
        type: "adr",
        id: "ADR-0001",
        source: adr.path,
      }));

      const route = await routeTask({ repo, task: "change repo-native canonical memory" });
      expect(route.routes[0]?.slug).toBe("context-memory");

      const loaded = await loadContext({ repo, route: "context-memory" });
      expect(loaded.adrs.map((item) => item.id)).toEqual(["ADR-0001"]);

      const model = await buildReviewModel({ repo });
      expect(model.summary.adrs).toBe(1);
      expect(model.nodes).toContainEqual(expect.objectContaining({
        id: "adr:ADR-0001",
        kind: "adr",
        subtitle: "Use repo-native canonical context",
      }));
      expect(model.edges).toContainEqual(expect.objectContaining({
        source: "fact:CTX001",
        target: "adr:ADR-0001",
        kind: "cites",
      }));
    });
  });

  test("validation accepts ADR ids as fact sources without IDMAP entries", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const adr = await createAdr({ repo, title: "Use ADR id sources" });
      await addContextPack(repo, adr.id);

      const validation = await validateProject({ repo });

      expect(validation.ok).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  test("validation reports malformed ADR metadata", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await writeFile(
        join(repo, "docs/context/adrs/ADR-0001-broken.md"),
        "---\nid: ADR-0001\nstatus: unknown\n---\n\n# Broken\n",
      );

      const validation = await validateProject({ repo });

      expect(validation.ok).toBe(false);
      expect(validation.errors).toContainEqual(expect.objectContaining({
        file: "docs/context/adrs/ADR-0001-broken.md",
        message: "invalid ADR status: unknown",
      }));
    });
  });
});
