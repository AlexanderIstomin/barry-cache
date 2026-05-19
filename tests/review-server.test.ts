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

      const html = createReviewHtml();
      expect(html).toContain("Barry Cache Review");
      expect(html).toContain("/api/model");
      expect(html).toContain("/assets/review.js");

      const server = await startReviewServer({ repo, port: 0, open: false });
      try {
        const response = await fetch(`${server.url}/api/model`);
        expect(response.status).toBe(200);
        const model = await response.json();
        expect(model.summary.features).toBe(1);
        expect(model.nodes.some((node: { id: string }) => node.id === "feature:search-index")).toBe(true);
        expect(model.tree.features.some((feature: { slug: string }) => feature.slug === "search-index")).toBe(true);

        const scriptResponse = await fetch(`${server.url}/assets/review.js`);
        expect(scriptResponse.status).toBe(200);
        const script = await scriptResponse.text();
        expect(script).toContain("tree-canvas");
        expect(script).toContain("headerFactCount(model)");
        expect(script).toContain("header-count");
        expect(script).toContain("canvas-controls");
        expect(script).toContain("leftPanelOpen");
        expect(script).toContain("inspectorOpen");
        expect(script).toContain("openInspector");
        expect(script).toContain("data-toggle-left-panel");
        expect(script).toContain("toggleLeftPanel");
        expect(script).toContain("data-feature-backdrop");
        expect(script).toContain("data-close-inspector");
        expect(script).toContain("closeInspector");
        expect(script).toContain("data-clear-search");
        expect(script).toContain("clearSearch");
        expect(script).toContain('search-row\' + (state.query ? " has-query" : "")');
        expect(script).toContain("if (isMobileLayout()) state.leftPanelOpen = false");
        expect(script).toContain("data-related-fact-id");
        expect(script).toContain("activateRelatedFact");
        expect(script).toContain("selectFactInTree");
        expect(script).toContain("previousFeature !== target.route");
        expect(script).toContain("centerTreeNode(target.treeUid, true, finishRelatedFactNavigation)");
        expect(script).toContain("transitionExpandedFactId");
        expect(script).toContain("sourceFactId");
        expect(script).toContain("finishRelatedFactNavigation");
        expect(script).toContain("state.transitionExpandedFactId === fact.id");
        expect(script).toContain("onComplete");
        expect(script).toContain("requestAnimationFrame(step)");
        expect(script).toContain("cancelTreeAnimation");
        expect(script).toContain("easeTreePan");
        expect(script).toContain("filterRelatedFactKeys");
        expect(script).toContain("value !== currentFactKey");
        expect(script).toContain("data-related-fact-key");
        expect(script).toContain("relatedFactTooltip(key)");
        expect(script).toContain("relatedFactClass(key)");
        expect(script).toContain("is-current-feature");
        expect(script).toContain("item.route === state.selectedFeature");
        expect(script).toContain('featureLabelForRoute(item.route) + ": " + assertion(item.fact)');
        expect(script).toContain('title="');
        expect(script).toContain("data-related-show-all");
        expect(script).toContain("state.showAllRelatedFacts = true");
        expect(script).toContain('data-related-show-all="true">+');
        expect(script).toContain("remainingCount + '</button>'");
        expect(script).not.toContain('remainingCount + " " + plural(remainingCount, "fact", "facts")');
        expect(script).toContain("prepareRelatedFactTarget(item.route, factId)");
        expect(script).toContain("state.selectedFeature = target.route");
        expect(script).toContain("centerTreeNode(target.treeUid, true, finishRelatedFactNavigation)");
        expect(script).toContain("var groupFactIds = group.factIds.filter");
        expect(script).toContain("groupFactIds.indexOf(factId) >= 0");
        expect(script).toContain("collapseTransitionExpansionBeforeZoomIn");
        expect(script).toContain("zoomInStarted");
        expect(script).toContain("progress >= 0.72");
        expect(script).toContain("midScale");
        expect(script).toContain("targetScale");
        expect(script).toContain("zoomOutScale");
        expect(script).toContain('id="tree-viewport"');
        expect(script).toContain("paintTreeFrame");
        expect(script).toContain("treeTransformValue");
        expect(script).toContain("suppressNextTreeClick");
        expect(script).toContain("panMoved");
        expect(script).toContain("startTreeUid");
        expect(script).toContain("selectedTreeUid");
        expect(script).toContain("state.selectedTreeUid === node.uid");
        expect(script).toContain("tree.byUid[state.selectedTreeUid]");
        expect(script).toContain("selectTreeNodeFromPointer");
        expect(script).toContain("event.button !== 0 && event.button !== 1");
        expect(script).toContain("data-expand-group");
        expect(script).toContain("renderRelatedFactLinks(tree)");
        expect(script).toContain("relatedFactLinks(tree)");
        expect(script).toContain("related-fact-link");
        expect(script).toContain("data-link-fact-key");
        expect(script).toContain("is-external");
        expect(script).toContain("is-hovered");
        expect(script).toContain("state.hoveredRelatedFactKey === link.factKey");
        expect(script).toContain("externalRelatedFactLinks");
        expect(script).toContain("visibleRelatedFactKeys()");
        expect(script).toContain("limitedRelatedFactLinks");
        expect(script).toContain("link.factKey === state.hoveredRelatedFactKey");
        expect(script).toContain("link.target ? target.x + target.width : source.x + source.width +");
        expect(script).toContain("setHoveredRelatedFactKey");
        expect(script).toContain('addEventListener("mouseenter"');
        expect(script).toContain('addEventListener("mouseleave"');
        expect(script).toContain('addEventListener("focus"');
        expect(script).toContain('addEventListener("blur"');
        expect(script).toContain("source.x + source.width");
        expect(script).toContain("target.x + target.width");
        expect(script).toContain("rightRail");
        expect(script).toContain("selectedRelatedKeySet");
        expect(script).toContain("otherKey");
        expect(script).toContain("!selectedRelatedKeySet[otherKey]");
        expect(script).toContain("defaultTreeTransform()");
        expect(script).toContain("leftPanelSafeTreeX()");
        expect(script).toContain("treeNodeTooltip(node)");
        expect(script).toContain("<title>");
        expect(script).toContain('<div class="inspector-body"><p class="inspector-subtitle">');
        expect(script).not.toContain('<p class="inspector-subtitle">\' + escapeHtml(subtitleValue) + \'</p></div>');
        expect(script).not.toContain("tree-meta");
        expect(script).not.toContain("reset-tree");
        expect(script).not.toContain("tree.feature ? tree.feature.label");
        expect(script).not.toContain("detail-body");
        expect(script).not.toContain("data-fact-focus");
        expect(script).not.toContain("renderDetails");
        expect(script).not.toContain("renderFacts");
        expect(script).not.toContain("activityTabHtml");
        expect(script).not.toContain("state.tab");
        expect(script).not.toContain('closest("[data-tree-uid]")) return');
        expect(script).not.toContain('tabButton("timeline", "Timeline")');
        expect(() => new Function(script)).not.toThrow();

        const cssResponse = await fetch(`${server.url}/assets/review.css`);
        expect(cssResponse.status).toBe(200);
        const css = await cssResponse.text();
        expect(css).toContain("height: 100dvh");
        expect(css).toContain("flex-wrap: wrap");
        expect(css).toContain(".workspace.is-left-panel-closed");
        expect(css).toContain(".workspace.is-inspector-closed");
        expect(css).toContain(".feature-backdrop");
        expect(css).toContain(".workspace:not(.is-left-panel-closed) .feature-backdrop");
        expect(css).toContain("position: relative");
        expect(css).toContain("inset: 0");
        expect(css).toContain("position: absolute");
        expect(css).toContain("left: 0");
        expect(css).toContain("right: 0");
        expect(css).toContain(".search-row");
        expect(css).toContain(".search-row:not(.has-query) .search-clear");
        expect(css).toContain(".inspector-header");
        expect(css).toContain(".inspector-body");
        expect(css).toContain(".tree-wrap");
        expect(css).toContain(".canvas-controls");
        expect(css).toContain(".workspace:not(.is-inspector-closed) .canvas-controls");
        expect(css).toContain(".header-count");
        expect(css).toContain("user-select: none");
        expect(css).toContain(".related-fact-link");
        expect(css).toContain(".related-fact-link.is-external");
        expect(css).toContain(".related-fact-link.is-hovered");
        expect(css).toContain("stroke: #d8d6cf");
        expect(css).toContain("pointer-events: none");
        expect(css).toContain("#tree-canvas svg");
        expect(css).toContain(".tree-node-card text");
        expect(css).toContain(".related-chip");
        expect(css).toContain(".related-chip.is-current-feature");
        expect(css).toContain(".related-chip.is-cross-feature");
        expect(css).not.toContain(".tree-toolbar");
        expect(css).not.toContain(".tree-meta");
        expect(css).not.toContain("grid-template-columns: 300px minmax(0, 1fr) 360px");
        expect(css).not.toContain("grid-template-columns: 0 minmax(0, 1fr) 360px");
        expect(css).not.toContain("grid-column: 2");
        expect(css).not.toContain("grid-column: 3");
        expect(css).not.toContain("grid-template-columns: 1fr;\n  }\n\n  .workspace.is-inspector-closed");
      } finally {
        await server.close();
      }
    });
  });
});
