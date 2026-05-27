import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdr } from "../src/core/adr";
import { finalizeProject, recordValidationFailure } from "../src/core/context";
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

async function addTimelinePack(repo: string, slug: string, title: string, facts: object[]): Promise<void> {
  const featureDir = join(repo, "docs/context/features", slug);
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "README.md"), `# ${title}\n\nTimeline ordering fixture.\n`);
  await writeFile(join(featureDir, "IDMAP.md"), "- `F01`: src/example.ts\n");
  await writeFile(join(featureDir, "KG.adj"), `${slug} owns timeline-order\n`);
  await writeFile(join(featureDir, "FACTS.jsonl"), facts.map((row) => JSON.stringify(row)).join("\n") + (facts.length > 0 ? "\n" : ""));
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
      expect(model.tree.features).toContainEqual(expect.objectContaining({
        slug: "renderer-runtime",
        factCount: 2,
      }));
      expect(model.tree.factIdsByRoute["renderer-runtime"]).toEqual(["RR001", "RR002"]);
      expect(model.tree.root.children.some((node) => node.id === "tree:feature:renderer-runtime")).toBe(true);
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

  test("builds grouped search items and canonical-first timeline events", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const adr = await createAdr({
        repo,
        title: "Use renderer transport clock",
        date: "2026-05-16",
        tags: ["renderer", "clock"],
      });
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
          },
          {
            id: "RR002",
            subject: "transport clock",
            predicate: "drives",
            object: "frame scheduler",
            src: [adr.path, "src/runtime/clock.ts"],
            status: "active",
            kind: "decision",
            updated_at: "2026-05-18",
          },
        ].map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
      await finalizeProject({
        repo,
        status: "success",
        summary: "Implemented renderer transport clock.",
        files: ["src/runtime/clock.ts"],
      });

      const model = await buildReviewModel({ repo });

      expect(model.search.groups.map((group) => group.kind)).toEqual([
        "feature",
        "fact",
        "adr",
        "entity",
        "source",
        "timeline",
      ]);
      expect(model.search.groups.find((group) => group.kind === "fact")?.items).toContainEqual(expect.objectContaining({
        id: "fact:RR002",
        label: "RR002",
        route: "renderer-runtime",
      }));
      expect(model.search.groups.find((group) => group.kind === "adr")?.items).toContainEqual(expect.objectContaining({
        id: "adr:ADR-0001",
        label: "ADR-0001",
      }));

      expect(model.timeline.map((item) => item.kind)).toEqual(["adr", "fact", "fact", "handoff"]);
      expect(model.timeline[0]).toEqual(expect.objectContaining({
        id: "timeline:adr:ADR-0001",
        timestamp: "2026-05-16",
        summary: "Use renderer transport clock",
      }));
      expect(model.timeline[2]).toEqual(expect.objectContaining({
        id: "timeline:fact:renderer-runtime:RR002",
        route: "renderer-runtime",
        summary: "transport clock drives frame scheduler",
      }));
      expect(model.timeline[2]?.related.adrs).toContain("ADR-0001");
      expect(model.timeline[2]?.related.sources).toContain("src/runtime/clock.ts");
      const handoff = model.timeline.find((item) => item.kind === "handoff");
      expect(handoff?.related.features).toContain("renderer-runtime");
      expect(handoff?.related.adrs).toContain("ADR-0001");

      expect(model.timelineView.features).toContainEqual(expect.objectContaining({
        route: "renderer-runtime",
        label: "Renderer Runtime",
        start: "2026-05-16",
        end: expect.stringMatching(/^2026-05-/),
        decisions: expect.arrayContaining([
          expect.objectContaining({ id: "timeline:adr:ADR-0001" }),
        ]),
        facts: expect.arrayContaining([
          expect.objectContaining({ id: "timeline:fact:renderer-runtime:RR001" }),
        ]),
        operations: expect.arrayContaining([
          expect.objectContaining({ kind: "handoff", summary: "Implemented renderer transport clock." }),
        ]),
      }));
      const rendererTimelineGroup = model.timelineView.features.find((feature) => feature.route === "renderer-runtime");
      expect(rendererTimelineGroup?.decisions).not.toContainEqual(expect.objectContaining({
        id: "timeline:fact:renderer-runtime:RR002",
      }));
      expect(model.timelineView.operations).not.toContainEqual(expect.objectContaining({
        kind: "handoff",
        summary: "Implemented renderer transport clock.",
      }));
      expect(model.timelineView.ticks).toContain("2026-05-16");
      expect(model.timelineView.ticks).toContain("2026-05-18");
    });
  });

  test("links fileless handoffs to feature timelines from summary evidence", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      await finalizeProject({
        repo,
        status: "success",
        summary: "Refined transport clock frame scheduler handoff.",
      });

      const model = await buildReviewModel({ repo });

      const handoff = model.timeline.find((item) => item.kind === "handoff");
      expect(handoff?.files).toEqual([]);
      expect(handoff?.route).toBe("renderer-runtime");
      expect(handoff?.related.features).toEqual(["renderer-runtime"]);
      expect(handoff?.related.facts).toContain("RR002");

      const rendererTimelineGroup = model.timelineView.features.find((feature) => feature.route === "renderer-runtime");
      expect(rendererTimelineGroup?.operations).toContainEqual(expect.objectContaining({
        kind: "handoff",
        summary: "Refined transport clock frame scheduler handoff.",
      }));
      expect(model.timelineView.operations).not.toContainEqual(expect.objectContaining({
        kind: "handoff",
        summary: "Refined transport clock frame scheduler handoff.",
      }));
    });
  });

  test("keeps ADR cards out of feature decision lanes when only implemented facts cite them", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const adr = await createAdr({
        repo,
        title: "Record validation failures as operational contradictions",
        date: "2026-05-27",
        tags: ["validation", "failures"],
      });
      await addTimelinePack(repo, "init-bootstrap", "Init Bootstrap", [
        {
          id: "INIT001",
          subject: "Barry validation failure protocol",
          predicate: "records",
          object: "user-reported failed validation as operational contradiction records",
          src: [adr.path],
          status: "active",
          kind: "decision",
          updated_at: "2026-05-27T10:35:15.000Z",
        },
      ]);
      await addTimelinePack(repo, "review-interface", "Review Interface", [
        {
          id: "REV001",
          subject: "Review timeline validation failures",
          predicate: "surface",
          object: "validation failure events and follow-up handoff fix links",
          src: [adr.path],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-27T10:35:16.000Z",
        },
      ]);

      const model = await buildReviewModel({ repo });

      const initGroup = model.timelineView.features.find((feature) => feature.route === "init-bootstrap");
      const reviewGroup = model.timelineView.features.find((feature) => feature.route === "review-interface");
      expect(initGroup?.decisions.map((item) => item.id)).toContain("timeline:adr:ADR-0001");
      expect(reviewGroup?.decisions.map((item) => item.id)).not.toContain("timeline:adr:ADR-0001");
      expect(reviewGroup?.facts).toContainEqual(expect.objectContaining({
        id: "timeline:fact:review-interface:REV001",
        related: expect.objectContaining({ adrs: ["ADR-0001"] }),
      }));
    });
  });

  test("surfaces validation failures and fix links in timeline relationships", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addRendererPack(repo);
      const handoff = await finalizeProject({
        repo,
        status: "success",
        summary: "Implemented renderer transport clock.",
        files: ["src/runtime/clock.ts"],
      });
      const failure = await recordValidationFailure({
        repo,
        summary: "User reported renderer transport clock still drifts.",
        expected: "Renderer clock remains aligned after the transport clock change.",
        actual: "Renderer clock drifts during playback.",
        challenges: [handoff.id, "RR001"],
        files: ["src/runtime/clock.ts"],
      });
      const fix = await finalizeProject({
        repo,
        status: "success",
        summary: "Fixed renderer clock drift after user validation failure.",
        files: ["src/runtime/clock.ts"],
        fixes: [failure.id],
      });
      expect(fix.id).not.toBe(handoff.id);

      const model = await buildReviewModel({ repo });

      const failureItem = model.timeline.find((item) => item.id === `failure:${failure.id}`);
      expect(failureItem).toEqual(expect.objectContaining({
        kind: "failure",
        status: "open",
        summary: "User reported renderer transport clock still drifts.",
        route: "renderer-runtime",
      }));
      expect(failureItem?.related.features).toContain("renderer-runtime");
      expect(failureItem?.related.facts).toContain("RR001");
      expect(failureItem?.related.challenges).toEqual([handoff.id, "RR001"]);

      const fixItem = model.timeline.find((item) => item.id === `handoff:${fix.id}`);
      expect(fixItem?.related.fixes).toEqual([failure.id]);
      expect(fixItem?.related.features).toContain("renderer-runtime");

      const rendererTimelineGroup = model.timelineView.features.find((feature) => feature.route === "renderer-runtime");
      expect(rendererTimelineGroup?.operations).toContainEqual(expect.objectContaining({
        kind: "failure",
        id: `failure:${failure.id}`,
      }));
      expect(rendererTimelineGroup?.operations).toContainEqual(expect.objectContaining({
        kind: "handoff",
        id: `handoff:${fix.id}`,
      }));
    });
  });

  test("does not attach fileless handoffs to weaker generic feature matches", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addTimelinePack(repo, "review-interface", "Review Interface", [
        {
          id: "REV001",
          subject: "Review feature cards",
          predicate: "use",
          object: "muted dusty rose color",
          src: ["F01"],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-26T16:20:00.000Z",
        },
      ]);
      await addTimelinePack(repo, "changelog-generation", "Changelog Generation", [
        {
          id: "CLG001",
          subject: "Changelog review",
          predicate: "lists",
          object: "feature files",
          src: ["F01"],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-20",
        },
      ]);
      await finalizeProject({
        repo,
        status: "success",
        summary: "Changed review feature card color from greenish sage to muted dusty rose.",
      });

      const model = await buildReviewModel({ repo });
      const handoff = model.timeline.find((item) => item.kind === "handoff");

      expect(handoff?.route).toBe("review-interface");
      expect(handoff?.related.features).toEqual(["review-interface"]);
      expect(handoff?.related.facts).toEqual(["REV001"]);
      expect(model.timelineView.features.find((feature) => feature.route === "review-interface")?.operations).toHaveLength(1);
      expect(model.timelineView.features.find((feature) => feature.route === "changelog-generation")?.operations).toHaveLength(0);
    });
  });

  test("sorts timeline feature groups chronologically with undated groups last", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      await addTimelinePack(repo, "alpha-undated", "Alpha Undated", []);
      await addTimelinePack(repo, "beta-later", "Beta Later", [
        {
          id: "BL001",
          subject: "beta",
          predicate: "ships",
          object: "later work",
          src: ["F01"],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-20",
        },
      ]);
      await addTimelinePack(repo, "gamma-earlier", "Gamma Earlier", [
        {
          id: "GE001",
          subject: "gamma",
          predicate: "ships",
          object: "earlier work",
          src: ["F01"],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-18",
        },
      ]);

      const model = await buildReviewModel({ repo });

      expect(model.timelineView.features.map((feature) => feature.route)).toEqual([
        "gamma-earlier",
        "beta-later",
        "alpha-undated",
      ]);
    });
  });

  test("uses full timestamps for same-day timeline feature ordering while displaying dates", async () => {
    await withTempRepo(async (repo) => {
      await initProject({ repo, yes: true });
      const adr = await createAdr({
        repo,
        title: "Alpha same-day decision",
        date: "2026-05-26",
      });
      await addTimelinePack(repo, "alpha-later", "Alpha Later", [
        {
          id: "AL001",
          subject: "alpha",
          predicate: "ships",
          object: "later same-day work",
          src: ["F01", adr.path],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-26T16:30:00.000Z",
        },
      ]);
      await addTimelinePack(repo, "beta-earlier", "Beta Earlier", [
        {
          id: "BE001",
          subject: "beta",
          predicate: "ships",
          object: "earlier same-day work",
          src: ["F01"],
          status: "active",
          kind: "implemented",
          updated_at: "2026-05-26T09:15:00.000Z",
        },
      ]);

      const model = await buildReviewModel({ repo });

      expect(model.timelineView.features.map((feature) => feature.route)).toEqual([
        "beta-earlier",
        "alpha-later",
      ]);
      expect(model.timelineView.features[0]).toEqual(expect.objectContaining({
        start: "2026-05-26",
        startTime: "2026-05-26T09:15:00.000Z",
      }));
    });
  });
});
