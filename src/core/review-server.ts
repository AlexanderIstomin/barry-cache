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
  --fact: #235347;
  --entity: #4f46a3;
  --source: #8a4b16;
  --handoff: #4f555c;
  --failure: #a33a32;
  --strategy: #6f4f8f;
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
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
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

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  color: var(--muted);
  font-size: 12px;
}

.kind-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kind-button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: left;
  padding: 6px 8px;
}

.count {
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.is-active .count {
  color: rgba(255, 255, 255, 0.72);
}

.main {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(360px, 1fr) 280px;
  height: 100vh;
}

.topbar {
  height: 58px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

h1 {
  margin: 0;
  font-size: 17px;
  line-height: 1.2;
}

.topbar-meta {
  color: var(--muted);
  font-size: 13px;
}

.workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
}

.graph-wrap {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: #fbfbf9;
  position: relative;
}

#graph {
  width: 100%;
  height: 100%;
  min-height: 360px;
}

.graph-empty {
  color: var(--muted);
  padding: 20px;
}

.edge {
  stroke: #cbc7bb;
  stroke-width: 1.1;
}

.edge.is-selected {
  stroke: #5c584f;
  stroke-width: 1.8;
}

.node circle {
  stroke: #ffffff;
  stroke-width: 2;
}

.node text {
  fill: var(--text);
  font-size: 11px;
  pointer-events: none;
}

.node.is-selected circle {
  stroke: #20201d;
  stroke-width: 2.5;
}

.node:hover circle {
  stroke: #20201d;
}

.inspector {
  min-width: 0;
  overflow: auto;
  background: var(--surface);
  padding: 18px;
}

.inspector-title {
  font-size: 16px;
  font-weight: 650;
  margin: 0 0 4px;
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

.details {
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--surface);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.tabs {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
}

.tab {
  min-height: 30px;
  padding: 5px 10px;
}

.detail-body {
  min-height: 0;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border-bottom: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}

th {
  color: var(--muted);
  font-weight: 600;
  background: var(--surface-muted);
  position: sticky;
  top: 0;
  z-index: 1;
}

td {
  font-size: 13px;
}

tr:hover td {
  background: #fbfbf8;
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

.timeline {
  display: flex;
  flex-direction: column;
}

.timeline-item {
  display: grid;
  grid-template-columns: 136px minmax(0, 1fr);
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding: 10px 14px;
}

.timeline-time {
  color: var(--muted);
  font-size: 12px;
}

.timeline-summary {
  font-weight: 560;
}

.timeline-source {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
  word-break: break-word;
}

.empty {
  color: var(--muted);
  padding: 18px;
}

@media (max-width: 900px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .main {
    height: auto;
    min-height: 100vh;
    grid-template-rows: auto 680px 320px;
  }

  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) 280px;
  }

  .graph-wrap {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
`;

const reviewJs = `
(function () {
  var state = {
    model: null,
    query: "",
    kind: "all",
    tab: "facts",
    selectedId: null
  };

  var kindOrder = ["feature", "fact", "entity", "source", "handoff", "failure", "strategy"];
  var kindColors = {
    feature: "#6f5f32",
    fact: "#235347",
    entity: "#4f46a3",
    source: "#8a4b16",
    handoff: "#4f555c",
    failure: "#a33a32",
    strategy: "#6f4f8f"
  };

  function load() {
    fetch("/api/model")
      .then(function (response) {
        if (!response.ok) throw new Error("Review API returned " + response.status);
        return response.json();
      })
      .then(function (model) {
        state.model = model;
        if (!state.selectedId && model.nodes.length > 0) {
          var firstUsefulNode = model.nodes.find(function (node) { return node.kind === "feature"; }) ||
            model.nodes.find(function (node) { return node.kind === "fact"; }) ||
            model.nodes[0];
          state.selectedId = firstUsefulNode.id;
        }
        render();
      })
      .catch(function (error) {
        document.getElementById("app").innerHTML = '<div class="empty">' + escapeHtml(error.message) + "</div>";
      });
  }

  function render() {
    var model = state.model;
    if (!model) return;
    var counts = countByKind(model.nodes);
    document.getElementById("app").innerHTML =
      '<div class="shell">' +
        '<aside class="sidebar">' +
          '<div class="brand"><div class="mark">B</div><div>Barry Cache</div></div>' +
          '<div class="sidebar-section">' +
            '<label class="label" for="search">Search memory</label>' +
            '<input id="search" value="' + attr(state.query) + '" autocomplete="off">' +
          "</div>" +
          '<div class="sidebar-section">' +
            '<div class="label">Graph filter</div>' +
            '<div class="kind-list">' +
              kindButton("all", "All", model.nodes.length) +
              kindOrder.map(function (kind) { return kindButton(kind, title(kind), counts[kind] || 0); }).join("") +
            "</div>" +
          "</div>" +
          '<div class="sidebar-section">' +
            '<div class="label">Summary</div>' +
            summaryLine("Features", model.summary.features) +
            summaryLine("Facts", model.summary.facts) +
            summaryLine("Sources", model.summary.sources) +
            summaryLine("Timeline", model.timeline.length) +
          "</div>" +
        "</aside>" +
        '<main class="main">' +
          '<header class="topbar">' +
            '<h1>Memory Review</h1>' +
            '<div class="topbar-meta">' + escapeHtml(formatDate(model.generated_at)) + ' · ' + escapeHtml(shortRepo(model.repo)) + "</div>" +
          "</header>" +
          '<section class="workspace">' +
            '<div class="graph-wrap"><div id="graph"></div></div>' +
            '<aside class="inspector" id="inspector"></aside>' +
          "</section>" +
          '<section class="details">' +
            '<div class="tabs">' +
              tabButton("facts", "Facts") +
              tabButton("timeline", "Timeline") +
              '<button class="tab" id="refresh" type="button">Refresh</button>' +
            "</div>" +
            '<div class="detail-body" id="detail-body"></div>' +
          "</section>" +
        "</main>" +
      "</div>";

    bind();
    drawGraph();
    renderInspector();
    renderDetails();
  }

  function bind() {
    document.getElementById("search").addEventListener("input", function (event) {
      state.query = event.target.value;
      drawGraph();
      renderDetails();
    });
    var kindButtons = document.querySelectorAll("[data-kind]");
    Array.prototype.forEach.call(kindButtons, function (button) {
      button.addEventListener("click", function () {
        state.kind = button.getAttribute("data-kind");
        render();
      });
    });
    var tabButtons = document.querySelectorAll("[data-tab]");
    Array.prototype.forEach.call(tabButtons, function (button) {
      button.addEventListener("click", function () {
        state.tab = button.getAttribute("data-tab");
        render();
      });
    });
    document.getElementById("refresh").addEventListener("click", load);
  }

  function drawGraph() {
    var graph = document.getElementById("graph");
    var nodes = filteredNodes();
    if (nodes.length === 0) {
      graph.innerHTML = '<div class="graph-empty">No nodes match the current filter.</div>';
      return;
    }

    var maxNodes = 180;
    nodes = nodes.slice(0, maxNodes);
    var visible = {};
    nodes.forEach(function (node) { visible[node.id] = true; });
    var edges = state.model.edges.filter(function (edge) { return visible[edge.source] && visible[edge.target]; }).slice(0, 320);
    var rect = graph.getBoundingClientRect();
    var width = Math.max(640, Math.floor(rect.width || 900));
    var height = Math.max(360, Math.floor(rect.height || 560));
    var positions = layout(nodes, width, height);
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Memory graph">';

    edges.forEach(function (edge) {
      var source = positions[edge.source];
      var target = positions[edge.target];
      if (!source || !target) return;
      var selected = state.selectedId === edge.source || state.selectedId === edge.target;
      svg += '<line class="edge' + (selected ? " is-selected" : "") + '" x1="' + source.x + '" y1="' + source.y + '" x2="' + target.x + '" y2="' + target.y + '"></line>';
    });

    nodes.forEach(function (node) {
      var point = positions[node.id];
      var selected = state.selectedId === node.id;
      var color = kindColors[node.kind] || "#555";
      var radius = node.kind === "feature" ? 9 : node.kind === "fact" ? 7 : 6;
      svg += '<g class="node' + (selected ? " is-selected" : "") + '" data-node-id="' + attr(node.id) + '" transform="translate(' + point.x + " " + point.y + ')">';
      svg += '<circle r="' + radius + '" fill="' + color + '"></circle>';
      if (node.kind === "feature" || node.kind === "fact" || selected) {
        svg += '<text x="' + (radius + 5) + '" y="4">' + escapeHtml(shortLabel(node.label)) + "</text>";
      }
      svg += "</g>";
    });

    svg += "</svg>";
    graph.innerHTML = svg;

    var renderedNodes = graph.querySelectorAll("[data-node-id]");
    Array.prototype.forEach.call(renderedNodes, function (item) {
      item.addEventListener("click", function () {
        state.selectedId = item.getAttribute("data-node-id");
        drawGraph();
        renderInspector();
      });
    });
  }

  function layout(nodes, width, height) {
    var centerX = width / 2;
    var centerY = height / 2;
    var maxRadius = Math.max(120, Math.min(width, height) * 0.42);
    var positions = {};
    var grouped = {};
    nodes.forEach(function (node) {
      if (!grouped[node.kind]) grouped[node.kind] = [];
      grouped[node.kind].push(node);
    });
    kindOrder.forEach(function (kind, kindIndex) {
      var group = grouped[kind] || [];
      if (group.length === 0) return;
      var radius = kind === "fact" ? maxRadius * 0.36 : kind === "feature" ? maxRadius * 0.18 : maxRadius * (0.54 + (kindIndex % 3) * 0.14);
      group.forEach(function (node, index) {
        var angle = ((Math.PI * 2) * index / group.length) + (kindIndex * 0.47);
        positions[node.id] = {
          x: Math.round(centerX + Math.cos(angle) * radius),
          y: Math.round(centerY + Math.sin(angle) * radius)
        };
      });
    });
    return positions;
  }

  function renderInspector() {
    var node = selectedNode();
    var inspector = document.getElementById("inspector");
    if (!node) {
      inspector.innerHTML = '<div class="empty">Select a node to inspect its source and metadata.</div>';
      return;
    }
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
    inspector.innerHTML =
      '<h2 class="inspector-title">' + escapeHtml(node.label) + "</h2>" +
      '<p class="inspector-subtitle">' + escapeHtml(node.subtitle || node.id) + "</p>" +
      '<dl class="kv">' + rows.map(function (row) {
        return "<dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(row[1]) + "</dd>";
      }).join("") + "</dl>";
  }

  function renderDetails() {
    var container = document.getElementById("detail-body");
    if (state.tab === "timeline") {
      renderTimeline(container);
      return;
    }
    renderFacts(container);
  }

  function renderFacts(container) {
    var query = state.query.trim().toLowerCase();
    var facts = state.model.facts.filter(function (item) {
      if (!query) return true;
      return [item.route, item.source, item.fact.id, item.fact.subject, item.fact.predicate, item.fact.object, item.fact.status, item.fact.kind].join(" ").toLowerCase().indexOf(query) >= 0;
    });
    if (facts.length === 0) {
      container.innerHTML = '<div class="empty">No facts match the current search.</div>';
      return;
    }
    container.innerHTML =
      '<table><thead><tr><th>ID</th><th>Route</th><th>Assertion</th><th>Status</th><th>Source</th></tr></thead><tbody>' +
      facts.map(function (item) {
        var fact = item.fact;
        return '<tr data-fact-id="' + attr("fact:" + fact.id) + '">' +
          "<td>" + escapeHtml(fact.id) + "</td>" +
          "<td>" + escapeHtml(item.route) + "</td>" +
          "<td>" + escapeHtml(fact.subject + " " + fact.predicate + " " + fact.object) + "</td>" +
          '<td><span class="status">' + escapeHtml(fact.status) + "</span></td>" +
          "<td>" + escapeHtml(item.source) + "</td>" +
        "</tr>";
      }).join("") +
      "</tbody></table>";
    var rows = container.querySelectorAll("[data-fact-id]");
    Array.prototype.forEach.call(rows, function (row) {
      row.addEventListener("click", function () {
        state.selectedId = row.getAttribute("data-fact-id");
        drawGraph();
        renderInspector();
      });
    });
  }

  function renderTimeline(container) {
    var query = state.query.trim().toLowerCase();
    var items = state.model.timeline.filter(function (item) {
      if (!query) return true;
      return [item.kind, item.summary, item.status || "", item.source, item.files.join(" ")].join(" ").toLowerCase().indexOf(query) >= 0;
    });
    if (items.length === 0) {
      container.innerHTML = '<div class="empty">No timeline records match the current search.</div>';
      return;
    }
    container.innerHTML =
      '<div class="timeline">' +
      items.map(function (item) {
        return '<div class="timeline-item" data-timeline-id="' + attr(item.id) + '">' +
          '<div class="timeline-time">' + escapeHtml(item.timestamp || "No date") + '<br><span class="status">' + escapeHtml(item.kind) + "</span></div>" +
          '<div><div class="timeline-summary">' + escapeHtml(item.summary) + '</div><div class="timeline-source">' + escapeHtml(item.source) + "</div></div>" +
        "</div>";
      }).join("") +
      "</div>";
    var rows = container.querySelectorAll("[data-timeline-id]");
    Array.prototype.forEach.call(rows, function (row) {
      row.addEventListener("click", function () {
        state.selectedId = row.getAttribute("data-timeline-id");
        drawGraph();
        renderInspector();
      });
    });
  }

  function filteredNodes() {
    var query = state.query.trim().toLowerCase();
    return state.model.nodes.filter(function (node) {
      if (state.kind !== "all" && node.kind !== state.kind) return false;
      if (!query) return true;
      return [node.id, node.kind, node.label, node.subtitle || "", node.source || "", formatValue(node.meta || {})].join(" ").toLowerCase().indexOf(query) >= 0;
    });
  }

  function selectedNode() {
    return state.model.nodes.find(function (node) { return node.id === state.selectedId; }) || state.model.nodes[0] || null;
  }

  function kindButton(kind, label, count) {
    return '<button type="button" class="kind-button' + (state.kind === kind ? " is-active" : "") + '" data-kind="' + attr(kind) + '">' +
      '<span>' + escapeHtml(label) + '</span><span class="count">' + count + "</span></button>";
  }

  function tabButton(tab, label) {
    return '<button type="button" class="tab' + (state.tab === tab ? " is-active" : "") + '" data-tab="' + attr(tab) + '">' + escapeHtml(label) + "</button>";
  }

  function summaryLine(label, value) {
    return '<div class="kind-button"><span>' + escapeHtml(label) + '</span><span class="count">' + value + "</span></div>";
  }

  function countByKind(nodes) {
    return nodes.reduce(function (counts, node) {
      counts[node.kind] = (counts[node.kind] || 0) + 1;
      return counts;
    }, {});
  }

  function title(input) {
    return input.charAt(0).toUpperCase() + input.slice(1);
  }

  function shortRepo(repo) {
    return repo.split(/[\\\\/]/).filter(Boolean).slice(-2).join("/");
  }

  function shortLabel(label) {
    return label.length > 28 ? label.slice(0, 27) + "..." : label;
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
