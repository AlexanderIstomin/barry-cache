import { spawn } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { platform } from "node:os";
import { buildReviewModel } from "./review-model";

export interface ReviewServerOptions {
  repo: string;
  port?: number;
  open?: boolean;
}

export interface RunningReviewServer {
  url: string;
  close: () => Promise<void>;
}

export async function startReviewServer(options: ReviewServerOptions): Promise<RunningReviewServer> {
  const port = options.port ?? 8787;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        send(response, 200, createReviewHtml(), "text/html; charset=utf-8");
        return;
      }
      if (url.pathname === "/api/model") {
        const model = await buildReviewModel({ repo: options.repo });
        send(response, 200, JSON.stringify(model), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === "/assets/review.css") {
        send(response, 200, reviewCss, "text/css; charset=utf-8");
        return;
      }
      if (url.pathname === "/assets/review.js") {
        send(response, 200, reviewJs, "text/javascript; charset=utf-8");
        return;
      }
      send(response, 404, "Not found", "text/plain; charset=utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(response, 500, JSON.stringify({ ok: false, error: message }), "application/json; charset=utf-8");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  if (options.open) openBrowser(url);
  return {
    url,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

export function createReviewHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="barry-api" content="/api/model">
    <title>Barry Cache Review</title>
    <link rel="stylesheet" href="/assets/review.css">
    <script src="/assets/review.js" defer></script>
  </head>
  <body>
    <div id="app">
      <div class="boot">Loading Barry Cache Review...</div>
    </div>
  </body>
</html>`;
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function openBrowser(url: string): void {
  const currentPlatform = platform();
  const command = currentPlatform === "darwin" ? "open" : currentPlatform === "win32" ? "cmd" : "xdg-open";
  const args = currentPlatform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

const reviewCss = `
:root {
  color-scheme: light;
  --bg: #f7f7f4;
  --surface: #ffffff;
  --surface-muted: #f0f0eb;
  --border: #d8d6cf;
  --border-strong: #bcb8ad;
  --text: #20201d;
  --muted: #666258;
  --faint: #8a8579;
  --focus: #3f6f5f;
  --feature: #6f5f32;
  --group: #356174;
  --fact: #235347;
  --entity: #4f46a3;
  --source: #8a4b16;
  --more: #6b6b63;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  font-size: 14px;
  line-height: 1.45;
  overflow: hidden;
}

button,
input {
  font: inherit;
}

button {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 7px;
  cursor: pointer;
  min-height: 32px;
}

button:hover {
  border-color: var(--border-strong);
}

button.is-active {
  background: var(--text);
  border-color: var(--text);
  color: var(--surface);
}

input {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 7px;
  min-height: 34px;
  padding: 6px 9px;
}

input:focus,
button:focus {
  outline: 2px solid rgba(63, 111, 95, 0.18);
  outline-offset: 1px;
  border-color: var(--focus);
}

.boot {
  padding: 24px;
  color: var(--muted);
}

.shell {
  min-height: 100dvh;
}

.main {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(420px, 1fr);
  height: 100dvh;
}

.topbar {
  min-height: 58px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 20px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
}

.mark {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 13px;
  background: var(--surface-muted);
}

button.mark {
  padding: 0;
  min-height: 26px;
}

h1 {
  margin: 0;
  font-size: 17px;
  line-height: 1.2;
}

.header-count {
  color: var(--muted);
  font-size: 13px;
  font-weight: 520;
}

.topbar-meta {
  color: var(--muted);
  font-size: 13px;
  text-align: right;
}

.workspace {
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.workspace.is-left-panel-closed .feature-panel,
.workspace.is-inspector-closed .inspector {
  display: none;
}

.feature-backdrop {
  display: none;
}

.feature-panel {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 4;
  width: 300px;
  min-width: 0;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.search-row:not(.has-query) {
  grid-template-columns: minmax(0, 1fr);
}

.search-row:not(.has-query) .search-clear {
  display: none;
}

.search-clear {
  width: 34px;
  padding: 0;
}

.search-clear:disabled {
  color: var(--faint);
  cursor: default;
  opacity: 0.5;
}

.label {
  color: var(--muted);
  font-size: 12px;
}

.feature-list,
.segment-list,
.summary-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.feature-button,
.summary-row {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  text-align: left;
  padding: 7px 8px;
}

.feature-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.is-active .count {
  color: rgba(255, 255, 255, 0.72);
}

.segment-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.segment-button {
  padding: 5px 7px;
}

.tree-wrap {
  position: absolute;
  inset: 0;
  z-index: 1;
  min-width: 0;
  min-height: 0;
  background: #fbfbf9;
}

.canvas-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tool-button {
  min-width: 36px;
  padding: 4px 8px;
}

.workspace:not(.is-inspector-closed) .canvas-controls {
  right: 372px;
}

#tree-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  contain: layout paint;
  user-select: none;
}

#tree-canvas svg {
  width: 100%;
  height: 100%;
  display: block;
}

#tree-canvas.is-panning {
  cursor: grabbing;
}

.tree-empty {
  color: var(--muted);
  padding: 20px;
}

.related-fact-link {
  fill: none;
  stroke: #d8d6cf;
  stroke-width: 0.9;
  stroke-opacity: 0.34;
  pointer-events: none;
}

.related-fact-link.is-external {
  stroke-dasharray: 4 5;
  stroke-linecap: round;
}

.related-fact-link.is-selected {
  stroke-opacity: 0.68;
  stroke-width: 1.1;
}

.related-fact-link.is-hovered {
  stroke: #5c584f;
  stroke-opacity: 0.92;
  stroke-width: 2;
}

.tree-edge {
  fill: none;
  stroke: #c8c3b6;
  stroke-width: 1.2;
}

.tree-edge.is-selected {
  stroke: #565148;
  stroke-width: 1.9;
}

.tree-node {
  cursor: pointer;
  user-select: none;
}

.tree-node rect,
.tree-node circle {
  stroke: #ffffff;
  stroke-width: 2;
}

.tree-node text {
  fill: var(--text);
  font-size: 12px;
  pointer-events: none;
}

.tree-node .node-subtitle {
  fill: var(--muted);
  font-size: 11px;
}

.tree-node-card text {
  fill: #ffffff;
}

.tree-node-card .node-subtitle {
  fill: rgba(255, 255, 255, 0.74);
}

.tree-node.is-selected rect,
.tree-node.is-selected circle {
  stroke: #20201d;
  stroke-width: 2.5;
}

.tree-node.is-dimmed {
  opacity: 0.28;
}

.tree-node:hover rect,
.tree-node:hover circle {
  stroke: #20201d;
}

.inspector {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 4;
  width: 360px;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--surface);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.inspector-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  border-bottom: 1px solid var(--border);
  padding: 18px 18px 12px;
}

.inspector-close {
  width: 32px;
  padding: 0;
}

.inspector-body {
  min-height: 0;
  overflow: auto;
  padding: 14px 18px 18px;
}

.inspector-title {
  font-size: 16px;
  font-weight: 650;
  margin: 0;
  word-break: break-word;
}

.inspector-subtitle {
  color: var(--muted);
  margin: 0 0 16px;
  word-break: break-word;
}

.kv {
  display: grid;
  grid-template-columns: 98px minmax(0, 1fr);
  gap: 7px 10px;
  margin-top: 14px;
}

.kv dt {
  color: var(--muted);
}

.kv dd {
  margin: 0;
  word-break: break-word;
}

.related-list {
  margin-top: 18px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.related-title {
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 8px;
}

.related-chip {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 6px;
  margin: 0 5px 5px 0;
  padding: 2px 6px;
  font-size: 12px;
  font: inherit;
  color: var(--muted);
  background: var(--surface);
  min-height: 0;
}

.related-chip[data-related-fact-id],
.related-chip[data-related-fact-key],
.related-chip[data-related-show-all] {
  cursor: pointer;
}

.related-chip[data-related-fact-id]:hover,
.related-chip[data-related-fact-key]:hover,
.related-chip[data-related-show-all]:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.related-chip.is-current-feature {
  border-color: var(--fact);
  color: #ffffff;
  background: var(--fact);
}

.related-chip.is-current-feature:hover {
  border-color: #173d34;
  color: #ffffff;
  background: #173d34;
}

.related-chip.is-cross-feature {
  border-color: var(--border);
  color: var(--muted);
  background: var(--surface);
}

.related-chip.is-cross-feature:hover {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--surface);
}

.related-more {
  color: var(--text);
}

.tab {
  min-height: 30px;
  padding: 5px 10px;
}

.status {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1px 5px;
  font-size: 12px;
  color: var(--muted);
  background: var(--surface);
}

.empty {
  color: var(--muted);
  padding: 18px;
}

@media (max-width: 1100px) {
  .main {
    height: 100dvh;
    min-height: 100dvh;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .workspace {
    min-height: 0;
  }

  .feature-panel {
    width: 280px;
  }

  .inspector {
    width: 340px;
    border-left: 1px solid var(--border);
    border-top: 0;
  }

  .workspace:not(.is-inspector-closed) .canvas-controls {
    right: 352px;
  }
}

@media (max-width: 760px) {
  body {
    overflow: hidden;
  }

  .main {
    height: 100dvh;
    min-height: 100dvh;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 12px 14px;
  }

  .topbar-meta {
    text-align: left;
  }

  .workspace {
    min-height: 0;
    overflow: hidden;
  }

  .workspace:not(.is-left-panel-closed) .feature-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 18;
    border: 0;
    border-radius: 0;
    background: rgba(32, 32, 29, 0.28);
  }

  .feature-panel {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 19;
    width: min(320px, calc(100vw - 52px));
    max-width: 100vw;
    border-right: 0;
    border-bottom: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }

  .inspector {
    inset: auto 0 0 0;
    width: auto;
    height: clamp(220px, 38dvh, 360px);
    border-left: 0;
    border-top: 1px solid var(--border);
  }

  .workspace:not(.is-inspector-closed) .canvas-controls {
    right: 12px;
  }
}
`;

const reviewJs = `
(function () {
  var state = {
    model: null,
    query: "",
    groupBy: "kind",
    selectedFeature: null,
    selectedId: null,
    selectedTreeUid: null,
    expandedFactId: null,
    transitionExpandedFactId: null,
    showAllRelatedFacts: false,
    expandedGroups: {},
    leftPanelOpen: true,
    responsivePanelInitialized: false,
    transformInitialized: false,
    inspectorOpen: true,
    transform: { x: 44, y: 48, scale: 1 },
    visibleTree: null,
    isPanning: false,
    panStart: null,
    panMoved: false,
    suppressNextTreeClick: false,
    treeAnimationFrame: null,
    hoveredRelatedFactKey: null
  };

  var groupOrder = ["kind", "predicate", "source", "status"];
  var groupLabels = {
    kind: "Kind",
    predicate: "Predicate",
    source: "Source",
    status: "Status"
  };
  var nodeColors = {
    feature: "#6f5f32",
    group: "#356174",
    fact: "#235347",
    entity: "#4f46a3",
    source: "#8a4b16",
    more: "#6b6b63"
  };

  function load() {
    fetch("/api/model")
      .then(function (response) {
        if (!response.ok) throw new Error("Review API returned " + response.status);
        return response.json();
      })
      .then(function (model) {
        state.model = model;
        initializeSelection(model);
        render();
      })
      .catch(function (error) {
        document.getElementById("app").innerHTML = '<div class="empty">' + escapeHtml(error.message) + "</div>";
      });
  }

  function initializeSelection(model) {
    var features = model.tree && model.tree.features ? model.tree.features : [];
    var selected = features.find(function (feature) { return feature.slug === state.selectedFeature; }) || features[0] || null;
    state.selectedFeature = selected ? selected.slug : null;
    if (!state.selectedId && selected) state.selectedId = featureTreeId(selected.slug);
    if (state.selectedId && state.selectedId.indexOf("tree:feature:") === 0 && selected) {
      state.selectedId = featureTreeId(selected.slug);
    }
    if (!state.selectedTreeUid && selected) state.selectedTreeUid = featureTreeId(selected.slug);
    if (!state.transformInitialized) {
      state.transform = defaultTreeTransform();
      state.transformInitialized = true;
    }
  }

  function render() {
    var model = state.model;
    if (!model) return;
    applyResponsivePanelDefaults();
    document.getElementById("app").innerHTML =
      '<div class="shell">' +
        '<main class="main">' +
          '<header class="topbar">' +
            '<div class="brand"><button class="mark" type="button" data-toggle-left-panel="true" aria-label="Toggle feature panel" title="Toggle feature panel">B</button><h1>Memory Review</h1><span class="header-count">' + escapeHtml(headerFactCount(model)) + '</span></div>' +
            '<div class="tool-group">' +
              '<div class="topbar-meta">' + escapeHtml(formatDate(model.generated_at)) + ' · ' + escapeHtml(shortRepo(model.repo)) + '</div>' +
              '<button class="tab" id="refresh" type="button">Refresh</button>' +
            '</div>' +
          '</header>' +
          '<section class="' + workspaceClass() + '">' +
            '<button class="feature-backdrop" type="button" data-feature-backdrop="true" aria-label="Close feature panel"></button>' +
            featurePanelHtml(model) +
            '<section class="tree-wrap">' +
              '<div class="canvas-controls" aria-label="Tree controls">' +
                '<button class="tool-button" id="fit-tree" type="button">Fit</button>' +
                '<button class="tool-button" id="zoom-out" type="button">-</button>' +
                '<button class="tool-button" id="zoom-in" type="button">+</button>' +
              '</div>' +
              '<div id="tree-canvas"></div>' +
            '</section>' +
            '<aside class="inspector" id="inspector"></aside>' +
          '</section>' +
        '</main>' +
      '</div>';

    bind();
    drawTree();
    renderInspector();
  }

  function featurePanelHtml(model) {
    var features = model.tree && model.tree.features ? model.tree.features : [];
    return '<aside class="feature-panel">' +
      '<div class="panel-section">' +
        '<label class="label" for="search">Search memory</label>' +
        '<div class="search-row' + (state.query ? " has-query" : "") + '">' +
          '<input id="search" value="' + attr(state.query) + '" autocomplete="off">' +
          '<button class="search-clear" type="button" data-clear-search="true" aria-label="Clear search" title="Clear search"' + (state.query ? "" : " disabled") + '>x</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-section">' +
        '<div class="label">Features</div>' +
        '<div class="feature-list">' +
          (features.length === 0 ? '<div class="empty">No memory facts found.</div>' : features.map(featureButton).join("")) +
        '</div>' +
      '</div>' +
      '<div class="panel-section">' +
        '<div class="label">Group by</div>' +
        '<div class="segment-list">' +
          groupOrder.map(function (groupBy) { return groupButton(groupBy); }).join("") +
        '</div>' +
      '</div>' +
      '<div class="panel-section">' +
        '<div class="label">Summary</div>' +
        '<div class="summary-list">' +
          summaryLine("Features", model.summary.features) +
          summaryLine("Facts", model.summary.facts) +
          summaryLine("Entities", model.summary.entities) +
          summaryLine("Sources", model.summary.sources) +
        '</div>' +
      '</div>' +
    '</aside>';
  }

  function bind() {
    document.getElementById("search").addEventListener("input", function (event) {
      cancelTreeAnimation();
      state.query = event.target.value;
      updateSearchClearButton();
      drawTree();
      renderInspector();
    });

    var clearSearchButton = document.querySelector("[data-clear-search]");
    if (clearSearchButton) clearSearchButton.addEventListener("click", clearSearch);

    var leftToggle = document.querySelector("[data-toggle-left-panel]");
    if (leftToggle) leftToggle.addEventListener("click", toggleLeftPanel);

    var featureBackdrop = document.querySelector("[data-feature-backdrop]");
    if (featureBackdrop) featureBackdrop.addEventListener("click", closeLeftPanel);

    Array.prototype.forEach.call(document.querySelectorAll("[data-feature]"), function (button) {
      button.addEventListener("click", function () {
        cancelTreeAnimation();
        var slug = button.getAttribute("data-feature");
        state.selectedFeature = slug;
        state.selectedId = featureTreeId(slug);
        state.selectedTreeUid = featureTreeId(slug);
        state.expandedFactId = null;
        state.transitionExpandedFactId = null;
        state.showAllRelatedFacts = false;
        state.hoveredRelatedFactKey = null;
        openInspector();
        state.expandedGroups = {};
        state.transform = defaultTreeTransform();
        if (isMobileLayout()) state.leftPanelOpen = false;
        render();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-group-by]"), function (button) {
      button.addEventListener("click", function () {
        cancelTreeAnimation();
        state.groupBy = button.getAttribute("data-group-by");
        state.selectedId = state.selectedFeature ? featureTreeId(state.selectedFeature) : null;
        state.selectedTreeUid = state.selectedId;
        state.expandedFactId = null;
        state.transitionExpandedFactId = null;
        state.showAllRelatedFacts = false;
        state.hoveredRelatedFactKey = null;
        openInspector();
        state.expandedGroups = {};
        state.transform = defaultTreeTransform();
        render();
      });
    });

    document.getElementById("refresh").addEventListener("click", function () {
      cancelTreeAnimation();
      load();
    });
    document.getElementById("fit-tree").addEventListener("click", fitTree);
    document.getElementById("zoom-in").addEventListener("click", function () { zoomAt(1.16); });
    document.getElementById("zoom-out").addEventListener("click", function () { zoomAt(0.86); });
    bindCanvas();
  }

  function clearSearch() {
    if (!state.query) return;
    cancelTreeAnimation();
    state.query = "";
    var input = document.getElementById("search");
    if (input) input.value = "";
    updateSearchClearButton();
    drawTree();
    renderInspector();
  }

  function updateSearchClearButton() {
    var button = document.querySelector("[data-clear-search]");
    if (button) button.disabled = !state.query;
    var row = document.querySelector(".search-row");
    if (row) row.classList.toggle("has-query", Boolean(state.query));
  }

  function toggleLeftPanel() {
    state.leftPanelOpen = !state.leftPanelOpen;
    render();
  }

  function closeLeftPanel() {
    if (!state.leftPanelOpen) return;
    state.leftPanelOpen = false;
    render();
  }

  function closeInspector() {
    state.hoveredRelatedFactKey = null;
    state.inspectorOpen = false;
    render();
  }

  function openInspector() {
    state.inspectorOpen = true;
    syncWorkspaceClass();
  }

  function bindCanvas() {
    var canvas = document.getElementById("tree-canvas");
    canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      var rect = canvas.getBoundingClientRect();
      zoomAt(event.deltaY > 0 ? 0.88 : 1.12, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    canvas.addEventListener("pointerdown", function (event) {
      if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
      if (event.button === 1) event.preventDefault();
      cancelTreeAnimation();
      state.isPanning = true;
      state.panMoved = false;
      state.suppressNextTreeClick = false;
      state.panStart = {
        pointerId: event.pointerId,
        button: event.button,
        startTreeUid: treeUidFromEvent(event),
        x: event.clientX,
        y: event.clientY,
        startX: state.transform.x,
        startY: state.transform.y
      };
      canvas.classList.add("is-panning");
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", function (event) {
      if (!state.isPanning || !state.panStart) return;
      var dx = event.clientX - state.panStart.x;
      var dy = event.clientY - state.panStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.panMoved = true;
      state.transform.x = state.panStart.startX + dx;
      state.transform.y = state.panStart.startY + dy;
      paintTreeFrame();
    });

    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);

    function endPan(event) {
      if (!state.isPanning) return;
      var wasMoved = state.panMoved;
      var startTreeUid = state.panStart ? state.panStart.startTreeUid : null;
      var startButton = state.panStart ? state.panStart.button : null;
      state.isPanning = false;
      state.suppressNextTreeClick = wasMoved || Boolean(startTreeUid);
      state.panStart = null;
      state.panMoved = false;
      canvas.classList.remove("is-panning");
      if (canvas.releasePointerCapture) canvas.releasePointerCapture(event.pointerId);
      if (!wasMoved && startButton === 0 && startTreeUid) selectTreeNodeFromPointer(startTreeUid);
      if (state.suppressNextTreeClick) {
        setTimeout(function () {
          state.suppressNextTreeClick = false;
        }, 120);
      }
    }
  }

  function treeUidFromEvent(event) {
    if (!event.target || !event.target.closest) return null;
    var node = event.target.closest("[data-tree-uid]");
    return node ? node.getAttribute("data-tree-uid") : null;
  }

  function selectTreeNodeFromPointer(treeUid) {
    if (!state.visibleTree || !treeUid) return;
    var node = state.visibleTree.byUid[treeUid];
    if (node) handleTreeNodeClick(node);
  }

  function drawTree() {
    var canvas = document.getElementById("tree-canvas");
    var tree = buildVisibleTree();
    layoutTree(tree);
    applySearchMatches(tree);
    state.visibleTree = tree;

    if (tree.nodes.length === 0) {
      canvas.innerHTML = '<div class="tree-empty">No memory facts found.</div>';
      return;
    }

    var rect = canvas.getBoundingClientRect();
    var width = Math.max(640, Math.floor(rect.width || 900));
    var height = Math.max(420, Math.floor(rect.height || 620));
    var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Memory tree">' +
      '<g id="tree-viewport" transform="' + treeTransformValue() + '">';

    svg += renderRelatedFactLinks(tree);

    tree.edges.forEach(function (edge) {
      var source = tree.byUid[edge.sourceUid];
      var target = tree.byUid[edge.targetUid];
      if (!source || !target) return;
      var sx = source.x + source.width;
      var sy = source.y;
      var tx = target.x;
      var ty = target.y;
      var mid = Math.max(50, (tx - sx) * 0.5);
      var selected = state.selectedTreeUid === source.uid || state.selectedTreeUid === target.uid;
      svg += '<path class="tree-edge' + (selected ? " is-selected" : "") + '" d="M ' + round(sx) + ' ' + round(sy) + ' C ' + round(sx + mid) + ' ' + round(sy) + ', ' + round(tx - mid) + ' ' + round(ty) + ', ' + round(tx) + ' ' + round(ty) + '"></path>';
    });

    tree.nodes.forEach(function (node) {
      svg += renderTreeNode(node);
    });

    svg += '</g></svg>';
    canvas.innerHTML = svg;

    Array.prototype.forEach.call(canvas.querySelectorAll("[data-tree-uid]"), function (item) {
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        if (state.suppressNextTreeClick) {
          state.suppressNextTreeClick = false;
          return;
        }
        var node = state.visibleTree.byUid[item.getAttribute("data-tree-uid")];
        if (node) handleTreeNodeClick(node);
      });
    });
  }

  function renderRelatedFactLinks(tree) {
    return relatedFactLinks(tree).map(function (link) {
      var source = link.source;
      var target = link.target;
      var sx = source.x + source.width;
      var sy = source.y;
      var tx = link.target ? target.x + target.width : source.x + source.width + externalLinkLength(link.stubIndex || 0);
      var ty = link.target ? target.y : source.y + externalLinkOffset(link.stubIndex || 0);
      var rightRail = link.target ? Math.max(sx, tx) + clamp(Math.abs(ty - sy) * 0.18, 44, 120) : tx + 24;
      var cx1 = link.target ? rightRail : sx + 42;
      var cy1 = sy;
      var cx2 = link.target ? rightRail : tx - 24;
      var cy2 = ty;
      var classes = "related-fact-link" +
        (link.selected ? " is-selected" : "") +
        (link.external ? " is-external" : "") +
        (state.hoveredRelatedFactKey === link.factKey ? " is-hovered" : "");
      return '<path class="' + classes + '" data-link-fact-key="' + attr(link.factKey || "") + '" d="M ' + round(sx) + ' ' + round(sy) + ' C ' + round(cx1) + ' ' + round(cy1) + ', ' + round(cx2) + ' ' + round(cy2) + ', ' + round(tx) + ' ' + round(ty) + '"></path>';
    }).join("");
  }

  function relatedFactLinks(tree) {
    var visibleFacts = tree.nodes.filter(function (node) { return node.kind === "fact" && node.factKey; });
    var visibleByKey = {};
    var selectedKey = selectedFactKey();
    var selectedRelatedKeySet = selectedKey ? factKeySet(selectedRelatedFactKeys()) : null;
    var seen = {};
    var links = [];
    visibleFacts.forEach(function (node) {
      visibleByKey[node.factKey] = node;
    });
    visibleFacts.forEach(function (source) {
      (source.factKeys || []).forEach(function (factKey) {
        var target = visibleByKey[factKey];
        if (!target || target.uid === source.uid) return;
        if (selectedKey) {
          if (source.factKey !== selectedKey && target.factKey !== selectedKey) return;
          var otherKey = source.factKey === selectedKey ? target.factKey : source.factKey;
          if (!selectedRelatedKeySet[otherKey]) return;
        }
        var pair = [source.uid, target.uid].sort().join("::");
        if (seen[pair]) return;
        seen[pair] = true;
        links.push({
          source: source,
          target: target,
          factKey: selectedKey ? otherKey : target.factKey,
          selected: Boolean(selectedKey && (source.factKey === selectedKey || target.factKey === selectedKey))
        });
      });
    });
    links = links.concat(externalRelatedFactLinks(selectedKey, visibleByKey));
    links.sort(function (a, b) {
      if (a.selected !== b.selected) return a.selected ? 1 : -1;
      var targetA = a.target ? a.target.uid : a.factKey;
      var targetB = b.target ? b.target.uid : b.factKey;
      return a.source.uid.localeCompare(b.source.uid) || targetA.localeCompare(targetB);
    });
    return limitedRelatedFactLinks(links);
  }

  function limitedRelatedFactLinks(links) {
    var limit = 180;
    var limited = links.slice(0, limit);
    if (!state.hoveredRelatedFactKey) return limited;
    var hasHovered = limited.some(function (link) { return link.factKey === state.hoveredRelatedFactKey; });
    if (hasHovered) return limited;
    var hovered = links.find(function (link) { return link.factKey === state.hoveredRelatedFactKey; });
    if (!hovered) return limited;
    if (limited.length < limit) {
      limited.push(hovered);
      return limited;
    }
    limited[limited.length - 1] = hovered;
    return limited;
  }

  function externalRelatedFactLinks(selectedKey, visibleByKey) {
    var source = selectedKey ? visibleByKey[selectedKey] : null;
    if (!source) return [];
    var externalKeys = visibleRelatedFactKeys().filter(function (factKey) {
      var parsed = parseFactKey(factKey);
      return parsed && parsed.route !== source.route && !visibleByKey[factKey];
    });
    if (state.hoveredRelatedFactKey && externalKeys.indexOf(state.hoveredRelatedFactKey) < 0) {
      var hovered = parseFactKey(state.hoveredRelatedFactKey);
      if (hovered && hovered.route !== source.route && !visibleByKey[state.hoveredRelatedFactKey]) {
        externalKeys.push(state.hoveredRelatedFactKey);
      }
    }
    var limited = externalKeys.slice(0, 72);
    if (state.hoveredRelatedFactKey && externalKeys.indexOf(state.hoveredRelatedFactKey) >= 0 && limited.indexOf(state.hoveredRelatedFactKey) < 0) {
      limited.push(state.hoveredRelatedFactKey);
    }
    return limited.map(function (factKey, index) {
      return {
        source: source,
        target: null,
        factKey: factKey,
        external: true,
        selected: true,
        stubIndex: index
      };
    });
  }

  function externalLinkLength(index) {
    return 76 + (index % 4) * 10;
  }

  function externalLinkOffset(index) {
    if (index === 0) return 0;
    var row = Math.ceil(index / 2);
    return (index % 2 === 0 ? 1 : -1) * Math.min(64, row * 12);
  }

  function buildVisibleTree() {
    var feature = currentFeature();
    var factsByKey = factMap();
    var nodes = [];
    var edges = [];
    var byUid = {};

    if (!feature) return { feature: null, nodes: nodes, edges: edges, byUid: byUid, factCount: 0 };

    var featureUid = featureTreeId(feature.slug);
    addNode({
      uid: featureUid,
      id: featureUid,
      kind: "feature",
      label: feature.label,
      subtitle: feature.factCount + " " + plural(feature.factCount, "fact", "facts"),
      route: feature.slug,
      factIds: factIdsForRoute(feature.slug),
      factKeys: factKeysForRoute(feature.slug),
      width: 220,
      height: 48,
      searchText: [feature.label, feature.slug].join(" ")
    });

    groupsForFeature(feature.slug).forEach(function (group) {
      var expanded = isGroupExpanded(group);
      var groupNode = addNode({
        uid: group.id,
        id: group.id,
        kind: "group",
        label: group.value,
        subtitle: groupLabels[group.groupBy],
        route: group.route,
        groupBy: group.groupBy,
        factIds: group.factIds,
        factKeys: group.factKeys,
        count: group.factIds.length,
        width: 220,
        height: 46,
        parentUid: featureUid,
        searchText: [group.value, group.groupBy, group.factIds.join(" ")].join(" ")
      });
      addEdge(featureUid, groupNode.uid);

      if (!expanded) {
        var moreUid = group.id + ":collapsed";
        var moreNode = addNode({
          uid: moreUid,
          id: group.id + ":more",
          kind: "more",
          label: group.factIds.length + " " + plural(group.factIds.length, "fact", "facts"),
          subtitle: "collapsed",
          route: group.route,
          factIds: group.factIds,
          factKeys: group.factKeys,
          parentGroupUid: group.id,
          width: 150,
          height: 40,
          parentUid: group.id,
          searchText: group.factIds.join(" ")
        });
        addEdge(group.id, moreNode.uid);
        return;
      }

      var groupFactIds = group.factIds.filter(function (factId) { return Boolean(factsByKey[factKeyFor(group.route, factId)]); });
      var visibleFactIds = groupFactIds;
      var query = state.query.trim().toLowerCase();
      if (query) {
        visibleFactIds = visibleFactIds.filter(function (factId) { return factMatchesQuery(factsByKey[factKeyFor(group.route, factId)], query); });
      }
      var limit = 25;
      var renderedFactIds = visibleFactIds.slice(0, limit);
      [selectedFactId(), state.expandedFactId, state.transitionExpandedFactId].forEach(function (factId) {
        if (factId && groupFactIds.indexOf(factId) >= 0 && renderedFactIds.indexOf(factId) < 0) renderedFactIds.push(factId);
      });
      renderedFactIds.forEach(function (factId) {
        var item = factsByKey[factKeyFor(group.route, factId)];
        var fact = item.fact;
        var factUid = group.id + ":fact:" + fact.id;
        var factNode = addNode({
          uid: factUid,
          id: "fact:" + fact.id,
          kind: "fact",
          label: fact.id,
          subtitle: shortLabel(assertion(fact), 42),
          route: item.route,
          factId: fact.id,
          factKey: factKeyFor(item.route, fact.id),
          factItem: item,
          factIds: relatedFactIdsForFact(item),
          factKeys: relatedFactKeysForFact(item),
          width: 250,
          height: 50,
          parentUid: group.id,
          searchText: factSearchText(item)
        });
        addEdge(group.id, factNode.uid);
        if (state.selectedTreeUid === factNode.uid || state.expandedFactId === fact.id || state.transitionExpandedFactId === fact.id) addFactLeaves(factNode, item);
      });

      var remaining = visibleFactIds.filter(function (factId) { return renderedFactIds.indexOf(factId) < 0; });
      if (remaining.length > 0) {
        var limitUid = group.id + ":limit";
        var limitNode = addNode({
          uid: limitUid,
          id: group.id + ":limit",
          kind: "more",
          label: "+" + remaining.length + " more",
          subtitle: "limited",
          route: group.route,
          factIds: remaining,
          factKeys: factKeysForRouteAndIds(group.route, remaining),
          parentGroupUid: group.id,
          width: 150,
          height: 40,
          parentUid: group.id,
          searchText: remaining.join(" ")
        });
        addEdge(group.id, limitNode.uid);
      }
    });

    return { feature: feature, nodes: nodes, edges: edges, byUid: byUid, factCount: feature.factCount };

    function addNode(node) {
      nodes.push(node);
      byUid[node.uid] = node;
      return node;
    }

    function addEdge(sourceUid, targetUid) {
      edges.push({ sourceUid: sourceUid, targetUid: targetUid });
    }

    function addFactLeaves(factNode, item) {
      var fact = item.fact;
      addEntityLeaf("subject", fact.subject);
      addEntityLeaf("object", fact.object);
      fact.src.forEach(function (source, index) {
        var sourceUid = factNode.uid + ":source:" + index;
        var sourceNode = addNode({
          uid: sourceUid,
          id: "source:" + source,
          kind: "source",
          label: source,
          subtitle: "source",
          route: item.route,
          sourceId: source,
          factIds: factIdsForSource(source),
          factKeys: factKeysForSource(source),
          width: 210,
          height: 42,
          parentUid: factNode.uid,
          searchText: source
        });
        addEdge(factNode.uid, sourceNode.uid);
      });

      function addEntityLeaf(role, label) {
        var entityUid = factNode.uid + ":" + role;
        var entityNode = addNode({
          uid: entityUid,
          id: "entity:" + slug(label),
          kind: "entity",
          label: label,
          subtitle: role,
          route: item.route,
          entityId: label,
          factIds: factIdsForEntity(label),
          factKeys: factKeysForEntity(label),
          width: 210,
          height: 42,
          parentUid: factNode.uid,
          searchText: label
        });
        addEdge(factNode.uid, entityNode.uid);
      }
    }
  }

  function layoutTree(tree) {
    var childrenByParent = {};
    tree.nodes.forEach(function (node) {
      if (!childrenByParent[node.parentUid || "root"]) childrenByParent[node.parentUid || "root"] = [];
      childrenByParent[node.parentUid || "root"].push(node);
    });

    var row = 0;
    var rowGap = 68;
    var columnGap = 278;
    var root = tree.nodes.find(function (node) { return !node.parentUid; });
    if (root) assign(root, 0);
    tree.nodes.forEach(function (node) {
      if (node.x === undefined || node.y === undefined) assign(node, 0);
    });

    function assign(node, depth) {
      node.x = depth * columnGap;
      var children = childrenByParent[node.uid] || [];
      if (children.length === 0) {
        node.y = row * rowGap;
        row += 1;
        return node.y;
      }
      var first = null;
      var last = null;
      children.forEach(function (child) {
        var childY = assign(child, depth + 1);
        if (first === null) first = childY;
        last = childY;
      });
      node.y = Math.round(((first || 0) + (last || 0)) / 2);
      return node.y;
    }
  }

  function applySearchMatches(tree) {
    var query = state.query.trim().toLowerCase();
    tree.nodes.forEach(function (node) {
      node.matches = !query || String(node.searchText || node.label || "").toLowerCase().indexOf(query) >= 0;
      node.branchMatches = node.matches;
    });
    for (var index = tree.nodes.length - 1; index >= 0; index -= 1) {
      var node = tree.nodes[index];
      if (!node.branchMatches || !node.parentUid) continue;
      var parent = tree.byUid[node.parentUid];
      if (parent) parent.branchMatches = true;
    }
  }

  function renderTreeNode(node) {
    var selected = state.selectedTreeUid === node.uid;
    var dimmed = state.query.trim() && !node.branchMatches && !selected;
    var classes = "tree-node tree-node-" + node.kind + (selected ? " is-selected" : "") + (dimmed ? " is-dimmed" : "");
    var fill = nodeColors[node.kind] || "#555";
    var x = round(node.x);
    var y = round(node.y - node.height / 2);
    var label = escapeHtml(shortLabel(node.label, node.kind === "fact" ? 32 : 28));
    var subtitle = node.subtitle ? escapeHtml(shortLabel(node.subtitle, node.kind === "fact" ? 38 : 30)) : "";
    var expandAttr = node.parentGroupUid ? ' data-expand-group="' + attr(node.parentGroupUid) + '"' : "";
    var html = '<g class="' + classes + '" data-tree-uid="' + attr(node.uid) + '" data-tree-id="' + attr(node.id) + '"' + expandAttr + '>';
    html += '<title>' + escapeHtml(treeNodeTooltip(node)) + '</title>';

    if (node.kind === "entity" || node.kind === "source") {
      html += '<circle cx="' + round(node.x + 14) + '" cy="' + round(node.y) + '" r="10" fill="' + fill + '"></circle>';
      html += '<text x="' + round(node.x + 30) + '" y="' + round(node.y - 2) + '">' + label + '</text>';
      if (subtitle) html += '<text class="node-subtitle" x="' + round(node.x + 30) + '" y="' + round(node.y + 14) + '">' + subtitle + '</text>';
    } else {
      html = html.replace('class="', 'class="tree-node-card ');
      html += '<rect x="' + x + '" y="' + y + '" width="' + node.width + '" height="' + node.height + '" rx="7" fill="' + fill + '"></rect>';
      html += '<text x="' + round(node.x + 12) + '" y="' + round(node.y - (subtitle ? 3 : -4)) + '">' + label + '</text>';
      if (subtitle) html += '<text class="node-subtitle" x="' + round(node.x + 12) + '" y="' + round(node.y + 14) + '">' + subtitle + '</text>';
    }

    html += '</g>';
    return html;
  }

  function treeNodeTooltip(node) {
    if (node.factItem) return assertion(node.factItem.fact);
    if (node.kind === "feature") return node.label + " · " + (node.subtitle || node.id);
    if (node.kind === "group") return node.label + " · " + (node.count || 0) + " " + plural(node.count || 0, "fact", "facts");
    if (node.kind === "more") return node.label + (node.subtitle ? " · " + node.subtitle : "");
    if (node.kind === "entity" || node.kind === "source") return node.label + (node.subtitle ? " · " + node.subtitle : "");
    return node.subtitle ? node.label + " · " + node.subtitle : node.label;
  }

  function handleTreeNodeClick(node) {
    cancelTreeAnimation();
    state.showAllRelatedFacts = false;
    state.hoveredRelatedFactKey = null;
    openInspector();
    state.selectedTreeUid = node.uid;
    if (node.kind === "group") {
      state.selectedId = node.id;
      state.expandedFactId = null;
      state.transitionExpandedFactId = null;
      syncWorkspaceClass();
      drawTree();
      renderInspector();
      return;
    }
    if (node.kind === "more" && node.parentGroupUid) {
      state.selectedId = node.id;
      state.expandedFactId = null;
      state.transitionExpandedFactId = null;
      setGroupExpandedKeepingAnchor(node.parentGroupUid, true);
      syncWorkspaceClass();
      renderInspector();
      return;
    }
    if (node.kind === "feature" && node.route) {
      state.selectedFeature = node.route;
      state.expandedFactId = null;
      state.transitionExpandedFactId = null;
    }
    if (node.kind === "fact" && node.factId) state.expandedFactId = node.factId;
    if ((node.kind === "entity" || node.kind === "source") && node.parentUid && state.visibleTree) {
      var parent = state.visibleTree.byUid[node.parentUid];
      if (parent && parent.factId) state.expandedFactId = parent.factId;
    }
    state.selectedId = node.id;
    syncWorkspaceClass();
    drawTree();
    renderInspector();
  }

  function setGroupExpandedKeepingAnchor(groupUid, expanded) {
    var anchor = state.visibleTree && state.visibleTree.byUid[groupUid];
    var anchorScreen = anchor ? {
      x: state.transform.x + anchor.x * state.transform.scale,
      y: state.transform.y + anchor.y * state.transform.scale
    } : null;
    state.expandedGroups[groupUid] = expanded;
    drawTree();
    if (!anchorScreen || !state.visibleTree || !state.visibleTree.byUid[groupUid]) return;
    var nextAnchor = state.visibleTree.byUid[groupUid];
    state.transform.x = anchorScreen.x - nextAnchor.x * state.transform.scale;
    state.transform.y = anchorScreen.y - nextAnchor.y * state.transform.scale;
    drawTree();
  }

  function fitTree() {
    cancelTreeAnimation();
    var canvas = document.getElementById("tree-canvas");
    var tree = state.visibleTree;
    if (!tree || tree.nodes.length === 0) return;
    var bounds = treeBounds(tree.nodes);
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, rect.width || 900);
    var height = Math.max(240, rect.height || 620);
    var contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    var contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    var scale = clamp(Math.min((width - 80) / contentWidth, (height - 80) / contentHeight), 0.3, 1.35);
    state.transform = {
      x: Math.round(40 - bounds.minX * scale),
      y: Math.round(40 - bounds.minY * scale),
      scale: scale
    };
    drawTree();
  }

  function zoomAt(multiplier, anchorX, anchorY) {
    cancelTreeAnimation();
    var canvas = document.getElementById("tree-canvas");
    var rect = canvas.getBoundingClientRect();
    var x = anchorX === undefined ? (rect.width || 900) / 2 : anchorX;
    var y = anchorY === undefined ? (rect.height || 620) / 2 : anchorY;
    var previous = state.transform.scale;
    var next = clamp(previous * multiplier, 0.3, 2.4);
    state.transform.x = x - ((x - state.transform.x) / previous) * next;
    state.transform.y = y - ((y - state.transform.y) / previous) * next;
    state.transform.scale = next;
    paintTreeFrame();
  }

  function renderInspector() {
    var inspector = document.getElementById("inspector");
    if (!inspector) return;
    var node = selectedTreeNode();
    if (!node) {
      var graphNode = selectedGraphNode();
      if (graphNode) {
        renderGraphInspector(inspector, graphNode);
        return;
      }
      state.inspectorOpen = false;
      inspector.innerHTML = "";
      return;
    }

    var rows = [
      ["Type", title(node.kind)],
      ["ID", node.id]
    ];
    if (node.route) rows.push(["Route", node.route]);
    if (node.groupBy) rows.push(["Group", groupLabels[node.groupBy] || node.groupBy]);
    if (node.count !== undefined) rows.push(["Facts", String(node.count)]);
    if (node.factItem) {
      var fact = node.factItem.fact;
      rows.push(["Status", fact.status]);
      rows.push(["Kind", fact.kind]);
      rows.push(["Updated", fact.updated_at || ""]);
      if (fact.confidence) rows.push(["Confidence", fact.confidence]);
      rows.push(["Source", node.factItem.source]);
    }
    if (node.entityId) rows.push(["Entity", node.entityId]);
    if (node.sourceId) rows.push(["Source", node.sourceId]);

    inspector.innerHTML = inspectorShellHtml(
      node.label,
      node.factItem ? assertion(node.factItem.fact) : (node.subtitle || node.id),
      '<dl class="kv">' + rows.filter(function (row) { return row[1] !== undefined && row[1] !== null && row[1] !== ""; }).map(function (row) {
        return '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      }).join("") + '</dl>' +
      relatedFactsHtml(selectedRelatedFactKeys())
    );
    bindInspectorControls(inspector);
    bindRelatedFactButtons(inspector);
  }

  function renderGraphInspector(inspector, node) {
    var rows = [
      ["Kind", node.kind],
      ["ID", node.id],
      ["Source", node.source || ""]
    ];
    Object.keys(node.meta || {}).sort().forEach(function (key) {
      var value = node.meta[key];
      if (value === undefined || value === null || value === "") return;
      rows.push([key, formatValue(value)]);
    });
    inspector.innerHTML = inspectorShellHtml(
      node.label,
      node.subtitle || node.id,
      '<dl class="kv">' + rows.map(function (row) {
        return '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      }).join("") + '</dl>' +
      relatedFactsHtml(selectedRelatedFactKeys())
    );
    bindInspectorControls(inspector);
    bindRelatedFactButtons(inspector);
  }

  function inspectorShellHtml(titleValue, subtitleValue, bodyHtml) {
    return '<div class="inspector-header">' +
      '<div><h2 class="inspector-title">' + escapeHtml(titleValue) + '</h2></div>' +
      '<button class="inspector-close" type="button" data-close-inspector="true" aria-label="Close inspector" title="Close inspector">x</button>' +
      '</div>' +
      '<div class="inspector-body"><p class="inspector-subtitle">' + escapeHtml(subtitleValue) + '</p>' + bodyHtml + '</div>';
  }

  function bindInspectorControls(root) {
    var closeButton = root.querySelector("[data-close-inspector]");
    if (closeButton) closeButton.addEventListener("click", closeInspector);
  }

  function relatedFactsHtml(factKeys) {
    if (!factKeys || factKeys.length === 0) return "";
    var limit = 24;
    var visibleKeys = visibleRelatedFactKeys();
    var visibleCount = state.showAllRelatedFacts ? factKeys.length : Math.min(factKeys.length, limit);
    var remainingCount = factKeys.length - visibleCount;
    return '<div class="related-list"><div class="related-title">Related facts</div>' +
      visibleKeys.map(function (key) {
        var item = factItemByKey(key);
        var id = item ? item.fact.id : factIdFromKey(key);
        var description = relatedFactTooltip(key);
        return '<button class="' + relatedFactClass(key) + '" type="button" data-related-fact-id="' + attr(id) + '" data-related-fact-key="' + attr(key) + '" title="' + attr(description) + '" aria-label="' + attr(id + ": " + description) + '">' + escapeHtml(id) + '</button>';
      }).join("") +
      (remainingCount > 0 ? '<button class="related-chip related-more" type="button" data-related-show-all="true">+' + remainingCount + '</button>' : "") +
      '</div>';
  }

  function bindRelatedFactButtons(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-related-fact-key]"), function (button) {
      var factKey = button.getAttribute("data-related-fact-key");
      button.addEventListener("mouseenter", function () {
        setHoveredRelatedFactKey(factKey);
      });
      button.addEventListener("mouseleave", function () {
        setHoveredRelatedFactKey(null);
      });
      button.addEventListener("focus", function () {
        setHoveredRelatedFactKey(factKey);
      });
      button.addEventListener("blur", function () {
        setHoveredRelatedFactKey(null);
      });
      button.addEventListener("click", function () {
        activateRelatedFact(factKey);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-related-show-all]"), function (button) {
      button.addEventListener("click", function () {
        state.showAllRelatedFacts = true;
        renderInspector();
      });
    });
  }

  function setHoveredRelatedFactKey(factKey) {
    if (state.hoveredRelatedFactKey === factKey) return;
    state.hoveredRelatedFactKey = factKey;
    drawTree();
  }

  function activateRelatedFact(factKey) {
    if (!factKey) return;
    var item = factItemByKey(factKey);
    if (!item) return;
    cancelTreeAnimation();
    state.showAllRelatedFacts = false;
    state.hoveredRelatedFactKey = null;
    openInspector();
    var previousFeature = state.selectedFeature;
    var sourceFactId = selectedFactId() || state.expandedFactId;
    var factId = item.fact.id;
    var target = prepareRelatedFactTarget(item.route, factId);
    if (!target) return;
    state.selectedFeature = target.route;
    state.selectedId = target.id;
    state.selectedTreeUid = target.treeUid;
    state.expandedFactId = target.factId;
    state.expandedGroups[target.groupUid] = true;
    state.transitionExpandedFactId = previousFeature === target.route && sourceFactId && sourceFactId !== factId ? sourceFactId : null;
    if (previousFeature !== target.route) {
      render();
      centerTreeNode(target.treeUid, true, finishRelatedFactNavigation);
      return;
    }
    syncWorkspaceClass();
    drawTree();
    centerTreeNode(target.treeUid, true, finishRelatedFactNavigation);
    renderInspector();
  }

  function finishRelatedFactNavigation() {
    if (!state.transitionExpandedFactId) return;
    state.transitionExpandedFactId = null;
    drawTree();
    renderInspector();
  }

  function selectFactInTree(route, factId) {
    var target = prepareRelatedFactTarget(route, factId);
    if (!target) {
      state.selectedTreeUid = null;
      return null;
    }
    state.expandedGroups[target.groupUid] = true;
    state.selectedTreeUid = target.treeUid;
    return target;
  }

  function prepareRelatedFactTarget(route, factId) {
    var group = groupsForFeature(route).find(function (candidate) {
      return candidate.factIds.indexOf(factId) >= 0;
    });
    if (!group) return null;
    return {
      route: route,
      factId: factId,
      id: "fact:" + factId,
      groupUid: group.id,
      treeUid: group.id + ":fact:" + factId
    };
  }

  function centerTreeNode(treeUid, animated, onComplete) {
    var canvas = document.getElementById("tree-canvas");
    var tree = state.visibleTree;
    if (!tree || !treeUid || !tree.byUid[treeUid]) {
      if (onComplete) onComplete();
      return;
    }
    var node = tree.byUid[treeUid];
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, rect.width || 900);
    var height = Math.max(240, rect.height || 620);
    var targetScale = animated ? clamp(Math.max(state.transform.scale, 1), 0.75, 1.35) : state.transform.scale;
    var target = centeredTreeTransform(node, width, height, targetScale);
    if (animated) {
      animateTreeTransform(target, node, width, height, onComplete);
      return;
    }
    cancelTreeAnimation();
    state.transform.x = target.x;
    state.transform.y = target.y;
    state.transform.scale = target.scale;
    paintTreeFrame();
    if (onComplete) onComplete();
  }

  function animateTreeTransform(target, node, width, height, onComplete) {
    cancelTreeAnimation(true);
    if (typeof requestAnimationFrame !== "function") {
      var collapsedTarget = collapseTransitionExpansionBeforeZoomIn(node.uid, width, height, target.scale, target.scale);
      if (collapsedTarget) target = collapsedTarget.target;
      state.transform.x = target.x;
      state.transform.y = target.y;
      state.transform.scale = target.scale;
      paintTreeFrame();
      if (onComplete) onComplete();
      return;
    }
    var start = {
      x: state.transform.x,
      y: state.transform.y,
      scale: state.transform.scale
    };
    var midScale = zoomOutScale(start.scale, target.scale);
    var midStart = zoomAroundViewport(start, width, height, midScale);
    var midTarget = centeredTreeTransform(node, width, height, midScale);
    var duration = 1500;
    var startedAt = null;
    var zoomInStarted = false;

    function step(timestamp) {
      if (startedAt === null) startedAt = timestamp;
      var progress = clamp((timestamp - startedAt) / duration, 0, 1);
      if (!zoomInStarted && progress >= 0.72) {
        zoomInStarted = true;
        var collapsed = collapseTransitionExpansionBeforeZoomIn(node.uid, width, height, midScale, target.scale);
        if (collapsed) {
          node = collapsed.node;
          midTarget = collapsed.midTarget;
          target = collapsed.target;
        }
      }
      var frame = treeTravelFrame(progress, start, midStart, midTarget, target);
      state.transform.x = frame.x;
      state.transform.y = frame.y;
      state.transform.scale = frame.scale;
      paintTreeFrame();
      if (progress < 1) {
        state.treeAnimationFrame = requestAnimationFrame(step);
        return;
      }
      state.transform.x = target.x;
      state.transform.y = target.y;
      state.transform.scale = target.scale;
      paintTreeFrame();
      state.treeAnimationFrame = null;
      if (onComplete) onComplete();
    }

    state.treeAnimationFrame = requestAnimationFrame(step);
  }

  function collapseTransitionExpansionBeforeZoomIn(treeUid, width, height, midScale, targetScale) {
    if (!state.transitionExpandedFactId) return null;
    state.transitionExpandedFactId = null;
    drawTree();
    if (!state.visibleTree || !state.visibleTree.byUid[treeUid]) return null;
    var node = state.visibleTree.byUid[treeUid];
    var midTarget = centeredTreeTransform(node, width, height, midScale);
    state.transform.x = midTarget.x;
    state.transform.y = midTarget.y;
    state.transform.scale = midTarget.scale;
    paintTreeFrame();
    return {
      node: node,
      midTarget: midTarget,
      target: centeredTreeTransform(node, width, height, targetScale)
    };
  }

  function treeTravelFrame(progress, start, midStart, midTarget, target) {
    if (progress < 0.32) {
      return interpolateTransform(start, midStart, easeTreePan(progress / 0.32));
    }
    if (progress < 0.72) {
      return interpolateTransform(midStart, midTarget, easeTreePan((progress - 0.32) / 0.4));
    }
    return interpolateTransform(midTarget, target, easeTreePan((progress - 0.72) / 0.28));
  }

  function interpolateTransform(from, to, progress) {
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      scale: from.scale + (to.scale - from.scale) * progress
    };
  }

  function paintTreeFrame() {
    var viewport = document.getElementById("tree-viewport");
    if (!viewport) {
      drawTree();
      return;
    }
    viewport.setAttribute("transform", treeTransformValue());
  }

  function treeTransformValue() {
    return "translate(" + transformNumber(state.transform.x) + " " + transformNumber(state.transform.y) + ") scale(" + transformNumber(state.transform.scale) + ")";
  }

  function transformNumber(value) {
    return Math.round(value * 1000) / 1000;
  }

  function centeredTreeTransform(node, width, height, scale) {
    return {
      x: Math.round(width / 2 - (node.x + node.width / 2) * scale),
      y: Math.round(height / 2 - node.y * scale),
      scale: scale
    };
  }

  function zoomAroundViewport(transform, width, height, scale) {
    var centerX = width / 2;
    var centerY = height / 2;
    return {
      x: Math.round(centerX - ((centerX - transform.x) / transform.scale) * scale),
      y: Math.round(centerY - ((centerY - transform.y) / transform.scale) * scale),
      scale: scale
    };
  }

  function zoomOutScale(startScale, targetScale) {
    return clamp(Math.min(startScale, targetScale) * 0.62, 0.32, 0.9);
  }

  function cancelTreeAnimation(keepTransitionExpansion) {
    if (state.treeAnimationFrame === null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.treeAnimationFrame);
    state.treeAnimationFrame = null;
    if (!keepTransitionExpansion) state.transitionExpandedFactId = null;
  }

  function easeTreePan(progress) {
    return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function selectedRelatedFactKeys() {
    var node = selectedTreeNode();
    if (node && node.factKeys) return filterRelatedFactKeys(node.factKeys);
    var item = selectedFactItem();
    if (item) return filterRelatedFactKeys(relatedFactKeysForFact(item));
    if (state.selectedFeature) return filterRelatedFactKeys(factKeysForRoute(state.selectedFeature));
    return [];
  }

  function visibleRelatedFactKeys() {
    var factKeys = selectedRelatedFactKeys();
    if (state.showAllRelatedFacts) return factKeys;
    var visible = factKeys.slice(0, 24);
    if (state.hoveredRelatedFactKey && factKeys.indexOf(state.hoveredRelatedFactKey) >= 0 && visible.indexOf(state.hoveredRelatedFactKey) < 0) {
      visible.push(state.hoveredRelatedFactKey);
    }
    return visible;
  }

  function filterRelatedFactKeys(factKeys) {
    var currentFactKey = selectedFactKey();
    var keys = unique(factKeys);
    if (!currentFactKey) return keys;
    return keys.filter(function (value) { return value !== currentFactKey; });
  }

  function relatedFactIdsForFact(item) {
    var ids = [item.fact.id];
    ids = ids.concat(factIdsForEntity(item.fact.subject));
    ids = ids.concat(factIdsForEntity(item.fact.object));
    item.fact.src.forEach(function (source) {
      ids = ids.concat(factIdsForSource(source));
    });
    return unique(ids);
  }

  function relatedFactKeysForFact(item) {
    var keys = [factKeyFor(item.route, item.fact.id)];
    keys = keys.concat(factKeysForEntity(item.fact.subject));
    keys = keys.concat(factKeysForEntity(item.fact.object));
    item.fact.src.forEach(function (source) {
      keys = keys.concat(factKeysForSource(source));
    });
    return unique(keys);
  }

  function groupsForFeature(route) {
    return state.model.tree.groups
      .filter(function (group) { return group.route === route && group.groupBy === state.groupBy; })
      .sort(function (a, b) {
        return b.factIds.length - a.factIds.length || a.value.localeCompare(b.value);
      });
  }

  function isGroupExpanded(group) {
    if (!group) return false;
    if (state.expandedGroups[group.id] !== undefined) return Boolean(state.expandedGroups[group.id]);
    return group.factIds.length <= 25;
  }

  function currentFeature() {
    var features = state.model && state.model.tree ? state.model.tree.features : [];
    return features.find(function (feature) { return feature.slug === state.selectedFeature; }) || features[0] || null;
  }

  function selectedTreeNode() {
    var tree = state.visibleTree;
    if (!tree || !state.selectedTreeUid) return null;
    return tree.byUid[state.selectedTreeUid] || null;
  }

  function selectedGraphNode() {
    if (!state.selectedId) return null;
    return state.model.nodes.find(function (node) { return node.id === state.selectedId; }) || null;
  }

  function selectedFactId() {
    return state.selectedId && state.selectedId.indexOf("fact:") === 0 ? state.selectedId.slice(5) : null;
  }

  function selectedFactKey() {
    var node = selectedTreeNode();
    if (node && node.factKey) return node.factKey;
    if (node && node.parentUid && state.visibleTree) {
      var parent = state.visibleTree.byUid[node.parentUid];
      if (parent && parent.factKey) return parent.factKey;
    }
    var factId = selectedFactId();
    return factId && state.selectedFeature ? factKeyFor(state.selectedFeature, factId) : null;
  }

  function selectedFactItem() {
    var key = selectedFactKey();
    return key ? factItemByKey(key) : null;
  }

  function factIdsForRoute(route) {
    return route && state.model.tree.factIdsByRoute[route] ? state.model.tree.factIdsByRoute[route] : [];
  }

  function factKeysForRoute(route) {
    if (!route) return [];
    if (state.model.tree.factKeysByRoute && state.model.tree.factKeysByRoute[route]) return state.model.tree.factKeysByRoute[route];
    return factIdsForRoute(route).map(function (id) { return factKeyFor(route, id); });
  }

  function factKeysForRouteAndIds(route, factIds) {
    return factIds.map(function (id) { return factKeyFor(route, id); });
  }

  function factIdsForEntity(entity) {
    return entity && state.model.tree.factIdsByEntity[entity] ? state.model.tree.factIdsByEntity[entity] : [];
  }

  function factKeysForEntity(entity) {
    if (!entity) return [];
    if (state.model.tree.factKeysByEntity && state.model.tree.factKeysByEntity[entity]) return state.model.tree.factKeysByEntity[entity];
    return factIdsForEntity(entity).map(function (id) { return factKeyFor(state.selectedFeature || "", id); });
  }

  function factIdsForSource(source) {
    return source && state.model.tree.factIdsBySource[source] ? state.model.tree.factIdsBySource[source] : [];
  }

  function factKeysForSource(source) {
    if (!source) return [];
    if (state.model.tree.factKeysBySource && state.model.tree.factKeysBySource[source]) return state.model.tree.factKeysBySource[source];
    return factIdsForSource(source).map(function (id) { return factKeyFor(state.selectedFeature || "", id); });
  }

  function factMap() {
    return state.model.facts.reduce(function (map, item) {
      map[factKeyFor(item.route, item.fact.id)] = item;
      return map;
    }, {});
  }

  function factItemByKey(key) {
    var parsed = parseFactKey(key);
    if (!parsed) return null;
    return state.model.facts.find(function (item) { return item.route === parsed.route && item.fact.id === parsed.id; }) || null;
  }

  function relatedFactTooltip(key) {
    var item = factItemByKey(key);
    return item ? featureLabelForRoute(item.route) + ": " + assertion(item.fact) : factIdFromKey(key);
  }

  function relatedFactClass(key) {
    var item = factItemByKey(key);
    var isCurrentFeature = item && state.selectedFeature && item.route === state.selectedFeature;
    return "related-chip" + (isCurrentFeature ? " is-current-feature" : " is-cross-feature");
  }

  function defaultTreeTransform() {
    return { x: leftPanelSafeTreeX(), y: 48, scale: 1 };
  }

  function leftPanelSafeTreeX() {
    if (!state.leftPanelOpen || isMobileLayout()) return 44;
    return (isCompactDesktopLayout() ? 280 : 300) + 24;
  }

  function workspaceClass() {
    var hasInspector = state.inspectorOpen && hasSelection();
    return "workspace" +
      (state.leftPanelOpen ? "" : " is-left-panel-closed") +
      (hasInspector ? "" : " is-inspector-closed");
  }

  function applyResponsivePanelDefaults() {
    if (state.responsivePanelInitialized) return;
    state.responsivePanelInitialized = true;
    if (isMobileLayout()) state.leftPanelOpen = false;
  }

  function isMobileLayout() {
    return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
  }

  function isCompactDesktopLayout() {
    return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 1100px)").matches;
  }

  function syncWorkspaceClass() {
    var workspace = document.querySelector(".workspace");
    if (workspace) workspace.className = workspaceClass();
  }

  function hasSelection() {
    return Boolean(state.selectedTreeUid || state.selectedId || selectedTreeNode() || selectedGraphNode());
  }

  function factKeyFor(route, id) {
    return route + "::" + id;
  }

  function parseFactKey(key) {
    var index = String(key).indexOf("::");
    if (index < 0) return state.selectedFeature ? { route: state.selectedFeature, id: String(key) } : null;
    return { route: String(key).slice(0, index), id: String(key).slice(index + 2) };
  }

  function factIdFromKey(key) {
    var parsed = parseFactKey(key);
    return parsed ? parsed.id : String(key);
  }

  function featureLabelForRoute(route) {
    var features = state.model && state.model.tree ? state.model.tree.features : [];
    var feature = features.find(function (item) { return item.slug === route; });
    return feature ? feature.label : route;
  }

  function factMatchesQuery(item, query) {
    return factSearchText(item).toLowerCase().indexOf(query) >= 0;
  }

  function factSearchText(item) {
    var fact = item.fact;
    return [item.route, item.source, fact.id, fact.subject, fact.predicate, fact.object, fact.status, fact.kind, (fact.tags || []).join(" "), fact.src.join(" ")].join(" ");
  }

  function assertion(fact) {
    return fact.subject + " " + fact.predicate + " " + fact.object;
  }

  function featureButton(feature) {
    return '<button type="button" class="feature-button' + (state.selectedFeature === feature.slug ? " is-active" : "") + '" data-feature="' + attr(feature.slug) + '">' +
      '<span class="feature-name">' + escapeHtml(feature.label) + '</span><span class="count">' + feature.factCount + '</span></button>';
  }

  function groupButton(groupBy) {
    return '<button type="button" class="segment-button' + (state.groupBy === groupBy ? " is-active" : "") + '" data-group-by="' + attr(groupBy) + '">' + escapeHtml(groupLabels[groupBy]) + '</button>';
  }

  function summaryLine(label, value) {
    return '<div class="summary-row"><span>' + escapeHtml(label) + '</span><span class="count">' + value + '</span></div>';
  }

  function headerFactCount(model) {
    var feature = currentFeature();
    var count = feature ? feature.factCount : model.summary.facts;
    return count + " " + plural(count, "fact", "facts");
  }

  function treeBounds(nodes) {
    return nodes.reduce(function (bounds, node) {
      bounds.minX = Math.min(bounds.minX, node.x);
      bounds.maxX = Math.max(bounds.maxX, node.x + node.width);
      bounds.minY = Math.min(bounds.minY, node.y - node.height / 2);
      bounds.maxY = Math.max(bounds.maxY, node.y + node.height / 2);
      return bounds;
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }

  function featureTreeId(slugValue) {
    return "tree:feature:" + slugValue;
  }

  function unique(values) {
    var seen = {};
    var result = [];
    values.forEach(function (value) {
      if (!value || seen[value]) return;
      seen[value] = true;
      result.push(value);
    });
    return result.sort();
  }

  function factKeySet(values) {
    return values.reduce(function (set, value) {
      if (value) set[value] = true;
      return set;
    }, {});
  }

  function title(input) {
    return input.charAt(0).toUpperCase() + input.slice(1);
  }

  function plural(count, singular, pluralValue) {
    return count === 1 ? singular : pluralValue;
  }

  function shortRepo(repo) {
    return repo.split(/[\\\\/]/).filter(Boolean).slice(-2).join("/");
  }

  function shortLabel(label, max) {
    var limit = max || 28;
    return String(label).length > limit ? String(label).slice(0, limit - 1) + "..." : String(label);
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString();
    } catch (_error) {
      return value;
    }
  }

  function formatValue(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function slug(input) {
    return String(input).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function attr(value) {
    return escapeHtml(String(value)).replace(/"/g, "&quot;");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  load();
})();
`;
