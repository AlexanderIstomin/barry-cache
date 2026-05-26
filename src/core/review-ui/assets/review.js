(function () {
  var state = {
    model: null,
    query: "",
    leftView: "timeline",
    groupBy: "kind",
    selectedFeature: null,
    selectedId: null,
    selectedTreeUid: null,
    selectedTimelineId: null,
    selectedTimelineArtifactId: null,
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
    factItemsByKey: null,
    isPanning: false,
    panStart: null,
    panMoved: false,
    suppressNextTreeClick: false,
    treeAnimationFrame: null,
    hoveredRelatedFactKey: null,
    expandedTimelineFacts: {},
    expandedTimelineArtifacts: {}
  };

  var groupOrder = ["kind", "predicate", "source", "status"];
  var groupLabels = {
    kind: "Kind",
    predicate: "Predicate",
    source: "Source",
    status: "Status"
  };
  var nodeColors = {
    feature: "#5b0000",
    group: "#356174",
    fact: "#235347",
    adr: "#5f4b7a",
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
        state.factItemsByKey = null;
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
    if (state.leftView === "timeline") {
      if (!state.selectedTimelineId && !state.selectedTimelineArtifactId) {
        var firstTimelineItem = firstTimelineItemForCanvas();
        state.selectedTimelineId = firstTimelineItem ? firstTimelineItem.id : null;
      }
      state.selectedId = null;
      state.selectedTreeUid = null;
    } else {
      if (!state.selectedId && selected) state.selectedId = featureTreeId(selected.slug);
      if (state.selectedId && state.selectedId.indexOf("tree:feature:") === 0 && selected) {
        state.selectedId = featureTreeId(selected.slug);
      }
      if (!state.selectedTreeUid && selected) state.selectedTreeUid = featureTreeId(selected.slug);
    }
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
              '<div class="canvas-controls" aria-label="Canvas controls">' +
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
    drawCanvas();
    renderInspector();
  }

  function featurePanelHtml(model) {
    return '<aside class="feature-panel">' +
      '<div class="panel-section">' +
        '<label class="label" for="search">Search memory</label>' +
        '<div class="search-row' + (state.query ? " has-query" : "") + '">' +
          '<input id="search" value="' + attr(state.query) + '" autocomplete="off">' +
          '<button class="search-clear" type="button" data-clear-search="true" aria-label="Clear search" title="Clear search"' + (state.query ? "" : " disabled") + '>x</button>' +
        '</div>' +
      '</div>' +
      '<div class="left-view-switch" role="tablist" aria-label="Review views">' +
        leftViewButton("features", "Features") +
        leftViewButton("timeline", "Timeline") +
      '</div>' +
      '<div data-panel-content="true">' +
        leftPanelContentHtml(model) +
      '</div>' +
    '</aside>';
  }

  function leftPanelContentHtml(model) {
    if (state.query.trim()) return searchResultsHtml(model);
    return state.leftView === "timeline" ? timelineSidebarHtml(model) : featuresViewHtml(model);
  }

  function featuresViewHtml(model) {
    var features = model.tree && model.tree.features ? model.tree.features : [];
    return '<div class="panel-stack">' +
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
    '</div>';
  }

  function bind() {
    document.getElementById("search").addEventListener("input", function (event) {
      cancelTreeAnimation();
      state.query = event.target.value;
      updateSearchClearButton();
      renderLeftPanelContent();
      drawCanvas();
      renderInspector();
    });

    var clearSearchButton = document.querySelector("[data-clear-search]");
    if (clearSearchButton) clearSearchButton.addEventListener("click", clearSearch);

    var leftToggle = document.querySelector("[data-toggle-left-panel]");
    if (leftToggle) leftToggle.addEventListener("click", toggleLeftPanel);

    var featureBackdrop = document.querySelector("[data-feature-backdrop]");
    if (featureBackdrop) featureBackdrop.addEventListener("click", closeLeftPanel);

    bindPanelContent();

    document.getElementById("refresh").addEventListener("click", function () {
      cancelTreeAnimation();
      load();
    });
    document.getElementById("fit-tree").addEventListener("click", fitTree);
    document.getElementById("zoom-in").addEventListener("click", function () { zoomAt(1.16); });
    document.getElementById("zoom-out").addEventListener("click", function () { zoomAt(0.86); });
    bindCanvas();
  }

  function bindPanelContent() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-left-view]"), function (button) {
      button.addEventListener("click", function () {
        setLeftView(button.getAttribute("data-left-view") || "features");
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-feature]"), function (button) {
      button.addEventListener("click", function () {
        cancelTreeAnimation();
        var slug = button.getAttribute("data-feature");
        state.leftView = "features";
        state.selectedFeature = slug;
        state.selectedId = featureTreeId(slug);
        state.selectedTreeUid = featureTreeId(slug);
        state.selectedTimelineId = null;
        state.selectedTimelineArtifactId = null;
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
        state.selectedTimelineId = null;
        state.selectedTimelineArtifactId = null;
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

    Array.prototype.forEach.call(document.querySelectorAll("[data-search-result]"), function (button) {
      button.addEventListener("click", function () {
        activateSearchResult(button.getAttribute("data-search-result"));
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-timeline-id]"), function (button) {
      button.addEventListener("click", function () {
        activateTimelineItem(button.getAttribute("data-timeline-id"));
      });
    });
  }

  function renderLeftPanelContent() {
    var panel = document.querySelector("[data-panel-content]");
    if (!panel || !state.model) return;
    panel.innerHTML = leftPanelContentHtml(state.model);
    bindPanelContent();
  }

  function clearSearch() {
    if (!state.query) return;
    cancelTreeAnimation();
    state.query = "";
    var input = document.getElementById("search");
    if (input) input.value = "";
    updateSearchClearButton();
    renderLeftPanelContent();
    drawCanvas();
    renderInspector();
  }

  function setLeftView(view) {
    cancelTreeAnimation();
    var previousView = state.leftView;
    state.leftView = view === "timeline" ? "timeline" : "features";
    state.hoveredRelatedFactKey = null;
    state.showAllRelatedFacts = false;
    if (previousView !== state.leftView) state.transform = defaultTreeTransform();
    if (state.leftView === "timeline") {
      if (!state.selectedTimelineId && !state.selectedTimelineArtifactId) {
        var firstTimelineItem = firstTimelineItemForCanvas();
        state.selectedTimelineId = firstTimelineItem ? firstTimelineItem.id : null;
      }
      state.selectedId = null;
      state.selectedTreeUid = null;
    } else {
      state.selectedTimelineId = null;
      state.selectedTimelineArtifactId = null;
      if (!state.selectedTreeUid) {
        var feature = currentFeature();
        if (feature) {
          state.selectedFeature = feature.slug;
          state.selectedId = featureTreeId(feature.slug);
          state.selectedTreeUid = state.selectedId;
        }
      }
    }
    openInspector();
    render();
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
      handleCanvasWheel(canvas, event);
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

  function handleCanvasWheel(canvas, event) {
    event.preventDefault();
    cancelTreeAnimation();
    var rect = canvas.getBoundingClientRect();
    var delta = normalizedWheelDelta(event);
    if (event.ctrlKey || event.metaKey) {
      zoomAt(wheelZoomMultiplier(delta.y), event.clientX - rect.left, event.clientY - rect.top);
      return;
    }
    panCanvasByWheelDelta(wheelPanDelta(event, delta));
  }

  function wheelPanDelta(event, delta) {
    if (event.shiftKey) return { x: delta.y || delta.x, y: 0 };
    return delta;
  }

  function panCanvasByWheelDelta(delta) {
    if (!delta.x && !delta.y) return;
    state.transform.x -= delta.x;
    state.transform.y -= delta.y;
    paintTreeFrame();
  }

  function normalizedWheelDelta(event) {
    var unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? 160 : 1);
    return {
      x: (event.deltaX || 0) * unit,
      y: (event.deltaY || 0) * unit
    };
  }

  function wheelZoomMultiplier(deltaY) {
    return clamp(Math.exp(-deltaY * 0.0044), 0.88, 1.12);
  }

  function treeUidFromEvent(event) {
    if (!event.target || !event.target.closest) return null;
    var node = event.target.closest("[data-tree-uid]");
    return node ? node.getAttribute("data-tree-uid") : null;
  }

  function selectTreeNodeFromPointer(treeUid) {
    if (!state.visibleTree || !treeUid) return;
    var node = state.visibleTree.byUid[treeUid];
    if (node) handleCanvasNodeClick(node);
  }

  function handleCanvasNodeClick(node) {
    if (node.kind === "timeline" && node.timelineId) {
      activateTimelineItem(node.timelineId);
      return;
    }
    if (node.kind === "timelineArtifact" && node.id) {
      activateTimelineArtifact(node.id);
      return;
    }
    if (node.kind === "timelineArtifactMore" && node.route) {
      toggleTimelineArtifacts(node.route);
      return;
    }
    if (node.kind === "timelineFactMore" && node.route) {
      toggleTimelineFacts(node.route);
      return;
    }
    if (node.kind === "timelineFeature" && node.route) {
      activateTimelineFeature(node.route);
      return;
    }
    handleTreeNodeClick(node);
  }

  function drawCanvas() {
    if (state.leftView === "timeline") {
      drawTimeline();
      return;
    }
    drawTree();
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
        if (node) handleCanvasNodeClick(node);
      });
    });
  }

  function drawTimeline() {
    var canvas = document.getElementById("tree-canvas");
    var tree = buildTimelineCanvas();
    state.visibleTree = tree;

    if (tree.nodes.length === 0) {
      canvas.innerHTML = '<div class="tree-empty">No timeline events found.</div>';
      return;
    }

    var rect = canvas.getBoundingClientRect();
    var width = Math.max(640, Math.floor(rect.width || 900));
    var height = Math.max(420, Math.floor(rect.height || 620));
    var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Implementation timeline">' +
      '<g id="tree-viewport" transform="' + treeTransformValue() + '">';

    svg += renderTimelineGuides(tree);

    tree.nodes.forEach(function (node) {
      svg += renderTimelineNode(node);
    });

    svg += '</g></svg>';
    canvas.innerHTML = svg;

    Array.prototype.forEach.call(canvas.querySelectorAll("[data-timeline-id]"), function (item) {
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        if (state.suppressNextTreeClick) {
          state.suppressNextTreeClick = false;
          return;
        }
        activateTimelineItem(item.getAttribute("data-timeline-id"));
      });
      item.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        activateTimelineItem(item.getAttribute("data-timeline-id"));
      });
    });

    Array.prototype.forEach.call(canvas.querySelectorAll("[data-timeline-artifact-more-route]"), function (item) {
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        if (state.suppressNextTreeClick) {
          state.suppressNextTreeClick = false;
          return;
        }
        toggleTimelineArtifacts(item.getAttribute("data-timeline-artifact-more-route"));
      });
      item.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggleTimelineArtifacts(item.getAttribute("data-timeline-artifact-more-route"));
      });
    });

    Array.prototype.forEach.call(canvas.querySelectorAll("[data-timeline-fact-more-route]"), function (item) {
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        if (state.suppressNextTreeClick) {
          state.suppressNextTreeClick = false;
          return;
        }
        toggleTimelineFacts(item.getAttribute("data-timeline-fact-more-route"));
      });
      item.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggleTimelineFacts(item.getAttribute("data-timeline-fact-more-route"));
      });
    });

  }

  function buildTimelineCanvas() {
    var groups = timelineFeatureGroups();
    var operations = timelineOperations();
    var nodes = [];
    var byUid = {};
    var guides = [];
    var x = 0;
    var featureY = 84;
    var decisionY = 218;
    var maxY = 520;

    groups.forEach(function (group, index) {
      var width = timelineGroupWidth(group);
      var rowOffset = (index % 2) * 48;
      var decisionRows = timelineDecisionRows(group);
      var decisionBlocks = timelineDecisionBlocks(group, decisionRows);
      var decisionStackHeight = timelineDecisionStackHeight(decisionBlocks);
      var factStartY = decisionY + rowOffset + Math.max(decisionStackHeight, 42) + 58;
      addTimelineCanvasNode(timelineLaneHeaderNode("Feature", group.route, x, featureY + rowOffset - 42, width));
      if (decisionRows.length > 0) addTimelineCanvasNode(timelineLaneHeaderNode("Decisions", group.route, x + 14, decisionY + rowOffset - 39, Math.min(width - 28, 520)));
      addTimelineCanvasNode({
        uid: "timeline:feature:" + group.route,
        id: "timeline:feature:" + group.route,
        kind: "timelineFeature",
        label: group.label,
        route: group.route,
      start: group.start,
      end: group.end,
      startTime: group.startTime,
      endTime: group.endTime,
      width: width,
      barWidth: width,
        height: 52,
        x: x,
        y: featureY + rowOffset,
        searchText: timelineGroupSearchText(group)
      });
      guides.push({ x: x, label: group.start });
      guides.push({ x: x + width, label: group.end && group.end !== group.start ? group.end : "" });

      var decisionCursorY = decisionY + rowOffset;
      decisionBlocks.forEach(function (block) {
        var item = block.decision;
        addTimelineCanvasNode(timelineItemNode(item, {
          uid: timelineScopedUid(group.route, item.id, "decision"),
          role: "decision",
          route: group.route,
          width: Math.min(width - 28, 520),
          height: 46,
          x: x + 14,
          y: decisionCursorY
        }));
        decisionCursorY += 58;
      });

      var groupFacts = group.facts || [];
      var visibleFacts = timelineVisibleFacts(group.route, groupFacts);
      var factWidth = Math.min(width - 28, 520);
      var factCursorY = factStartY;
      if (groupFacts.length > 0) addTimelineCanvasNode(timelineLaneHeaderNode("Implemented", group.route, x + 20, factStartY - 22, factWidth));
      visibleFacts.forEach(function (item) {
        var factHeight = timelineFactNodeHeight(item, factWidth);
        addTimelineCanvasNode(timelineItemNode(item, {
          uid: timelineScopedUid(group.route, item.id, "fact"),
          role: "fact",
          route: group.route,
          width: factWidth,
          height: factHeight,
          x: x + 20,
          y: factCursorY
        }));
        factCursorY += factHeight + 12;
      });
      var hiddenFacts = groupFacts.length - visibleFacts.length;
      if (hiddenFacts > 0 || (timelineFactsExpanded(group.route) && groupFacts.length > timelineFactDisplayLimit())) {
        addTimelineCanvasNode(timelineFactMoreNode(group.route, x + 20, factCursorY, factWidth, hiddenFacts));
        factCursorY += 34;
      }

      var groupArtifacts = timelineGroupArtifacts(group);
      var visibleArtifacts = timelineVisibleArtifacts(group.route, groupArtifacts);
      var artifactStartY = factCursorY + (groupFacts.length > 0 ? 10 : 0);
      if (visibleArtifacts.length > 0) {
        addTimelineCanvasNode(timelineLaneHeaderNode("Artifacts", group.route, x + 20, artifactStartY, Math.min(width - 28, 520)));
        visibleArtifacts.forEach(function (artifact, artifactIndex) {
          addTimelineCanvasNode(timelineArtifactNode(artifact, group.route, x + 26, artifactStartY + 24 + artifactIndex * 22, Math.min(width - 34, 514), "group:" + artifactIndex));
        });
      }
      var hiddenArtifacts = groupArtifacts.length - visibleArtifacts.length;
      var artifactBottomY = artifactStartY + (visibleArtifacts.length > 0 ? 24 + visibleArtifacts.length * 22 : 0);
      if (hiddenArtifacts > 0 || (timelineArtifactsExpanded(group.route) && groupArtifacts.length > timelineArtifactDisplayLimit())) {
        addTimelineCanvasNode(timelineArtifactMoreNode(group.route, x + 26, artifactBottomY + 8, Math.min(width - 34, 514), hiddenArtifacts));
        artifactBottomY += 30;
      }

      var groupOperations = group.operations || [];
      var operationStartY = artifactBottomY + (groupOperations.length > 0 ? 22 : 0);
      var operationBottomY = operationStartY;
      if (groupOperations.length > 0) {
        addTimelineCanvasNode(timelineLaneHeaderNode("Activity", group.route, x + 20, operationStartY, Math.min(width - 28, 520)));
        groupOperations.forEach(function (item, operationIndex) {
          addTimelineCanvasNode(timelineItemNode(item, {
            uid: timelineScopedUid(group.route, item.id, "operation"),
            role: "operation",
            route: group.route,
            width: Math.min(width - 28, 520),
            height: 44,
            x: x + 20,
            y: operationStartY + 34 + operationIndex * 56
          }));
        });
        operationBottomY = operationStartY + 34 + groupOperations.length * 56;
      }

      var groupBottomY = Math.max(decisionCursorY, factCursorY, artifactBottomY, operationBottomY);
      maxY = Math.max(maxY, groupBottomY + 96);
      x += width + 92;
    });

    var operationY = maxY;
    operations.slice(0, 10).forEach(function (item, index) {
      addTimelineCanvasNode(timelineItemNode(item, {
        uid: item.id,
        role: "operation",
        width: 260,
        height: 44,
        x: index * 286,
        y: operationY + index * 56
      }));
    });
    if (operations.length > 0) maxY = operationY + operations.length * 56 + 86;

    return { feature: null, nodes: nodes, edges: [], byUid: byUid, factCount: groups.length, guides: guides, maxY: maxY };

    function addTimelineCanvasNode(node) {
      var query = state.query.trim().toLowerCase();
      node.matches = !query || String(node.searchText || node.label || "").toLowerCase().indexOf(query) >= 0;
      node.branchMatches = node.matches;
      nodes.push(node);
      byUid[node.uid] = node;
      return node;
    }
  }

  function renderTimelineNode(node) {
    if (node.kind === "timelineLaneHeader") return renderTimelineLaneHeaderNode(node);
    if (node.kind === "timelineFeature") return renderTimelineFeatureBand(node);
    if (node.kind === "timelineArtifact") return renderTimelineArtifactNode(node);
    if (node.kind === "timelineArtifactMore") return renderTimelineArtifactMoreNode(node);
    if (node.kind === "timelineFactMore") return renderTimelineFactMoreNode(node);
    if (node.role === "decision") return renderTimelineDecisionNode(node);
    if (node.role === "fact") return renderTimelineFactBullet(node);
    if (node.role === "operation") return renderTimelineOperationNode(node);
    return "";
  }

  function renderTimelineGuides(tree) {
    var maxY = tree.maxY || 560;
    return (tree.guides || []).filter(function (guide) { return Boolean(guide.label); }).map(function (guide) {
      return '<g class="timeline-guide"><text class="timeline-date-label" x="' + round(guide.x + 8) + '" y="18">' + escapeHtml(shortTimelineDate(guide.label)) + '</text><line x1="' + round(guide.x) + '" y1="34" x2="' + round(guide.x) + '" y2="' + round(maxY) + '"></line></g>';
    }).join("");
  }

  function renderTimelineLaneHeaderNode(node) {
    return '<g class="timeline-lane-header"><text x="' + round(node.x) + '" y="' + round(node.y) + '">' + escapeHtml(node.label) + '</text></g>';
  }

  function renderTimelineFeatureBand(node) {
    var selected = state.selectedId === "feature:" + node.route && !state.selectedTimelineId;
    var dimmed = state.query.trim() && !node.matches && !selected;
    var classes = "tree-node timeline-node timeline-feature-band" + (selected ? " is-selected" : "") + (dimmed ? " is-dimmed" : "");
    var color = timelineNodeColor(node);
    var x = round(node.x);
    var y = round(node.y - node.height / 2);
    var html = '<g class="' + classes + '" data-tree-uid="' + attr(node.uid) + '">';
    html += '<title>' + escapeHtml(timelineNodeTooltip(node)) + '</title>';
    html += '<rect x="' + x + '" y="' + y + '" width="' + node.width + '" height="' + node.height + '" rx="8" fill="' + attr(color) + '"></rect>';
    html += '<text x="' + round(node.x + 18) + '" y="' + round(node.y - 3) + '">' + escapeHtml(shortLabel(node.label, timelineTextLimit(node.width, 40, 34, 78))) + '</text>';
    html += '<text class="timeline-node-date" x="' + round(node.x + 18) + '" y="' + round(node.y + 16) + '">' + escapeHtml(timelineRangeLabel(node.start, node.end)) + '</text>';
    html += '</g>';
    return html;
  }

  function renderTimelineDecisionNode(node) {
    var selected = state.selectedTimelineId === node.timelineId;
    var dimmed = state.query.trim() && !node.matches && !selected;
    var relatedHover = state.hoveredRelatedFactKey && state.hoveredRelatedFactKey === node.factKey;
    var classes = "tree-node tree-node-card timeline-node timeline-decision-node timeline-node-" + node.timelineKind + (selected ? " is-selected" : "") + (relatedHover ? " is-related-hover" : "") + (dimmed ? " is-dimmed" : "");
    var color = timelineNodeColor(node);
    var x = round(node.x);
    var y = round(node.y - node.height / 2);
    var factAttr = node.factKey ? ' data-fact-key="' + attr(node.factKey) + '"' : "";
    var html = '<g class="' + classes + '" data-tree-uid="' + attr(node.uid) + '" data-timeline-id="' + attr(node.timelineId) + '"' + factAttr + ' role="button" tabindex="0" aria-label="' + attr("Open " + timelineNodeTooltip(node)) + '">';
    html += '<title>' + escapeHtml(timelineNodeTooltip(node)) + '</title>';
    html += '<rect x="' + x + '" y="' + y + '" width="' + node.width + '" height="' + node.height + '" rx="7" fill="' + attr(color) + '"></rect>';
    html += '<text class="timeline-node-date" x="' + round(node.x + 12) + '" y="' + round(node.y - 4) + '">' + escapeHtml(shortLabel(node.subtitle, timelineTextLimit(node.width, 26, 34, 62))) + '</text>';
    html += '<text x="' + round(node.x + 12) + '" y="' + round(node.y + 14) + '">' + escapeHtml(shortLabel(node.summary || node.label, timelineTextLimit(node.width, 26, 42, 76))) + '</text>';
    html += '</g>';
    return html;
  }

  function renderTimelineFactBullet(node) {
    var selected = state.selectedTimelineId === node.timelineId;
    var dimmed = state.query.trim() && !node.matches && !selected;
    var relatedHover = state.hoveredRelatedFactKey && state.hoveredRelatedFactKey === node.factKey;
    var classes = "tree-node timeline-node timeline-fact-bullet" + (selected ? " is-selected" : "") + (relatedHover ? " is-related-hover" : "") + (dimmed ? " is-dimmed" : "");
    var color = timelineNodeColor(node);
    var description = node.summary || node.label;
    var html = '<g class="' + classes + '" data-tree-uid="' + attr(node.uid) + '" data-timeline-id="' + attr(node.timelineId) + '" data-fact-key="' + attr(node.factKey || "") + '" role="button" tabindex="0" aria-label="' + attr("Open " + node.label + ": " + description) + '">';
    html += '<title>' + escapeHtml(timelineNodeTooltip(node)) + '</title>';
    html += '<rect class="timeline-hit-area" x="' + round(node.x - 4) + '" y="' + round(node.y - 13) + '" width="' + node.width + '" height="' + round(node.height + 8) + '" rx="5"></rect>';
    html += '<circle cx="' + round(node.x + 5) + '" cy="' + round(node.y - 4) + '" r="3.2" fill="' + attr(color) + '"></circle>';
    html += renderTimelineFactText(node, description);
    html += '</g>';
    return html;
  }

  function renderTimelineFactText(node, description) {
    return '<foreignObject x="' + round(node.x + 18) + '" y="' + round(node.y - 12) + '" width="' + round(node.width - 24) + '" height="' + round(node.height) + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" class="timeline-fact-text">' + escapeHtml(description) + '</div>' +
      '</foreignObject>';
  }

  function renderTimelineArtifactNode(node) {
    var selected = state.selectedTimelineArtifactId === node.id;
    var dimmed = state.query.trim() && !node.matches && !selected;
    return '<g class="timeline-artifact-item' + (selected ? " is-selected" : "") + (dimmed ? " is-dimmed" : "") + '" data-tree-uid="' + attr(node.uid) + '" data-timeline-artifact-id="' + attr(node.id) + '" role="button" tabindex="0" aria-label="' + attr("Open " + timelineArtifactTitle(node.label)) + '">' +
      '<title>' + escapeHtml(timelineArtifactTitle(node.label)) + '</title>' +
      '<rect class="timeline-artifact-hit-area" x="' + round(node.x - 4) + '" y="' + round(node.y - 13) + '" width="' + node.width + '" height="24" rx="5"></rect>' +
      '<circle cx="' + round(node.x + 5) + '" cy="' + round(node.y - 1) + '" r="2.8"></circle>' +
      '<text x="' + round(node.x + 18) + '" y="' + round(node.y + 3) + '">' + escapeHtml(shortLabel(timelineArtifactLabel(node.label), timelineTextLimit(node.width, 28, 44, 76))) + '</text></g>';
  }

  function renderTimelineArtifactMoreNode(node) {
    var titleValue = node.expanded ? "Show fewer artifacts" : "Show all artifacts";
    var label = node.expanded ? "Show less" : "+" + node.hiddenCount + " more";
    return '<g class="timeline-artifact-more' + (state.query.trim() && !node.matches ? " is-dimmed" : "") + '" data-tree-uid="' + attr(node.uid) + '" data-timeline-artifact-more-route="' + attr(node.route) + '" role="button" tabindex="0" aria-label="' + attr(titleValue) + '">' +
      '<title>' + escapeHtml(titleValue) + '</title>' +
      '<rect class="timeline-artifact-more-hit-area" x="' + round(node.x - 4) + '" y="' + round(node.y - 13) + '" width="' + node.width + '" height="24" rx="5"></rect>' +
      '<text x="' + round(node.x + 18) + '" y="' + round(node.y + 3) + '">' + escapeHtml(label) + '</text></g>';
  }

  function renderTimelineFactMoreNode(node) {
    var titleValue = node.expanded ? "Show fewer implemented facts" : "Show all implemented facts";
    var label = node.expanded ? "Show less" : "+" + node.hiddenCount + " more";
    return '<g class="timeline-fact-more' + (state.query.trim() && !node.matches ? " is-dimmed" : "") + '" data-tree-uid="' + attr(node.uid) + '" data-timeline-fact-more-route="' + attr(node.route) + '" role="button" tabindex="0" aria-label="' + attr(titleValue) + '">' +
      '<title>' + escapeHtml(titleValue) + '</title>' +
      '<rect class="timeline-fact-more-hit-area" x="' + round(node.x - 4) + '" y="' + round(node.y - 13) + '" width="' + node.width + '" height="24" rx="5"></rect>' +
      '<text x="' + round(node.x + 18) + '" y="' + round(node.y + 3) + '">' + escapeHtml(label) + '</text></g>';
  }

  function renderTimelineOperationNode(node) {
    var selected = state.selectedTimelineId === node.timelineId;
    var dimmed = state.query.trim() && !node.matches && !selected;
    var classes = "tree-node timeline-node timeline-operation-node timeline-node-" + node.timelineKind + (selected ? " is-selected" : "") + (dimmed ? " is-dimmed" : "");
    var color = timelineNodeColor(node);
    var x = round(node.x);
    var y = round(node.y - node.height / 2);
    var html = '<g class="' + classes + '" data-tree-uid="' + attr(node.uid) + '" data-timeline-id="' + attr(node.timelineId) + '" role="button" tabindex="0" aria-label="' + attr("Open " + timelineNodeTooltip(node)) + '">';
    html += '<title>' + escapeHtml(timelineNodeTooltip(node)) + '</title>';
    html += '<rect x="' + x + '" y="' + y + '" width="' + node.width + '" height="' + node.height + '" rx="7" fill="' + attr(color) + '"></rect>';
    html += '<text class="timeline-node-date" x="' + round(node.x + 12) + '" y="' + round(node.y - 3) + '">' + escapeHtml(shortLabel(timelineNodeSubtitle(node.item || node), timelineTextLimit(node.width, 26, 32, 60))) + '</text>';
    html += '<text x="' + round(node.x + 12) + '" y="' + round(node.y + 14) + '">' + escapeHtml(shortLabel(node.summary || node.label, timelineTextLimit(node.width, 24, 36, 120))) + '</text>';
    html += '</g>';
    return html;
  }

  function timelineTextLimit(width, reserved, min, max) {
    return clamp(Math.floor((width - reserved) / 6.4), min, max);
  }

  function timelineNodeColor(node) {
    if (node.kind === "timelineFeature") return nodeColors.feature;
    if (node.role === "fact") return nodeColors.fact;
    if (node.timelineKind) return timelineKindColor(node.timelineKind);
    return nodeColors.more;
  }

  function timelineItemsForCanvas() {
    return state.model && state.model.timeline ? state.model.timeline : [];
  }

  function timelineFeatureGroups() {
    return state.model && state.model.timelineView && state.model.timelineView.features ? state.model.timelineView.features : [];
  }

  function timelineDecisionBlocks(group, decisions) {
    return (decisions || []).map(function (decision) {
      return {
        decision: decision,
        facts: timelineFactsForDecision(group, decision)
      };
    });
  }

  function timelineFactsForDecision(group, decision) {
    var decisionAdrs = (decision.related && decision.related.adrs) || [];
    var decisionArtifacts = timelineArtifactsForItems([decision]);
    return (group.facts || []).filter(function (fact) {
      var factAdrs = (fact.related && fact.related.adrs) || [];
      if (hasIntersection(decisionAdrs, factAdrs)) return true;
      if (decision.kind === "fact" && hasIntersection(decisionArtifacts, timelineArtifactsForItems([fact]))) return true;
      return false;
    });
  }

  function timelineArtifactsForDecision(block) {
    var decision = block.decision;
    if (decision.kind === "adr") return [];
    return timelineArtifactsForItems([decision].concat(block.facts || []));
  }

  function timelineGroupArtifacts(group) {
    var events = (group.events || []).filter(function (item) { return item.kind !== "adr"; });
    return timelineArtifactsForItems(events);
  }

  function timelineVisibleFacts(route, facts) {
    return timelineFactsExpanded(route) ? facts : facts.slice(0, timelineFactDisplayLimit());
  }

  function timelineFactsExpanded(route) {
    return Boolean(route && state.expandedTimelineFacts[route]);
  }

  function toggleTimelineFacts(route) {
    if (!route) return;
    state.expandedTimelineFacts[route] = !state.expandedTimelineFacts[route];
    drawCanvas();
  }

  function timelineFactDisplayLimit() {
    return 20;
  }

  function timelineFactMoreNode(route, x, y, width, hiddenCount) {
    return {
      uid: "timeline:fact-more:" + route,
      id: "timeline:fact-more:" + route,
      kind: "timelineFactMore",
      label: "implemented more",
      route: route,
      width: width,
      height: 24,
      x: x,
      y: y,
      hiddenCount: hiddenCount,
      expanded: timelineFactsExpanded(route),
      searchText: route + " implemented facts more"
    };
  }

  function timelineVisibleArtifacts(route, artifacts) {
    return timelineArtifactsExpanded(route) ? artifacts : artifacts.slice(0, timelineArtifactDisplayLimit());
  }

  function timelineArtifactsExpanded(route) {
    return Boolean(route && state.expandedTimelineArtifacts[route]);
  }

  function toggleTimelineArtifacts(route) {
    if (!route) return;
    state.expandedTimelineArtifacts[route] = !state.expandedTimelineArtifacts[route];
    drawCanvas();
  }

  function timelineArtifactDisplayLimit() {
    return 6;
  }

  function timelineArtifactsForItems(items) {
    var values = [];
    (items || []).forEach(function (item) {
      values = values.concat(item.files || []);
      if (item.related && item.related.sources) values = values.concat(item.related.sources);
    });
    return unique(values.filter(Boolean));
  }

  function timelineArtifactNode(artifact, route, x, y, width, scope) {
    return {
      uid: "timeline:artifact:" + route + ":" + slug(scope || "artifact") + ":" + slug(artifact),
      id: "timeline:artifact:" + route + ":" + slug(scope || "artifact") + ":" + slug(artifact),
      kind: "timelineArtifact",
      label: artifact,
      route: route,
      width: width,
      height: 18,
      x: x,
      y: y,
      searchText: route + " " + artifact
    };
  }

  function timelineArtifactMoreNode(route, x, y, width, hiddenCount) {
    return {
      uid: "timeline:artifact-more:" + route,
      id: "timeline:artifact-more:" + route,
      kind: "timelineArtifactMore",
      label: "artifact more",
      route: route,
      hiddenCount: hiddenCount,
      expanded: timelineArtifactsExpanded(route),
      width: width,
      height: 18,
      x: x,
      y: y,
      searchText: route
    };
  }

  function timelineArtifactLabel(artifact) {
    var parts = String(artifact || "").split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : String(artifact || "");
  }

  function timelineArtifactTitle(artifact) {
    return String(artifact || "");
  }

  function relatedFactKeysForArtifact(artifact, route) {
    var keys = factKeysForSource(artifact);
    timelineItemsForArtifactRoute(route).forEach(function (item) {
      if (!timelineArtifactMatchesItem(artifact, item)) return;
      keys = keys.concat(timelineRelatedFactKeys(item, route));
    });
    return unique(keys.filter(function (key) { return Boolean(factItemByKey(key)); }));
  }

  function timelineInspectorRelatedFactKeys(item) {
    if (!item || item.kind === "fact") return [];
    if (item.kind === "adr") return relatedFactKeysForTimelineAdr(item);
    return unique(timelineRelatedFactKeys(item, item.route).filter(function (key) {
      return Boolean(factItemByKey(key));
    }));
  }

  function relatedFactKeysForTimelineAdr(item) {
    var adrIds = item && item.related && item.related.adrs ? item.related.adrs : [];
    if (adrIds.length === 0) return [];
    var keys = [];
    timelineItemsForCanvas().forEach(function (candidate) {
      var candidateAdrs = candidate.related && candidate.related.adrs ? candidate.related.adrs : [];
      if (candidate.kind !== "fact" || !hasIntersection(adrIds, candidateAdrs)) return;
      keys = keys.concat(timelineRelatedFactKeys(candidate, candidate.route));
    });
    return unique(keys.filter(function (key) { return Boolean(factItemByKey(key)); }));
  }

  function timelineItemsForArtifactRoute(route) {
    if (!route) return timelineItemsForCanvas();
    var group = timelineFeatureGroups().find(function (candidate) { return candidate.route === route; });
    return group && group.events ? group.events : timelineItemsForCanvas();
  }

  function timelineArtifactMatchesItem(artifact, item) {
    return timelineArtifactsForItems([item]).some(function (source) {
      return timelineArtifactSourceMatches(source, artifact);
    });
  }

  function timelineArtifactSourceMatches(source, artifact) {
    var left = stripSourceFragment(source);
    var right = stripSourceFragment(artifact);
    return left === right || left.endsWith("/" + right) || right.endsWith("/" + left);
  }

  function stripSourceFragment(source) {
    return String(source || "").split("#")[0];
  }

  function timelineRelatedFactKeys(item, fallbackRoute) {
    var related = item.related || {};
    var routes = unique([item.route, fallbackRoute].concat(related.features || []).filter(Boolean));
    var keys = [];
    (related.facts || []).forEach(function (factId) {
      routes.forEach(function (route) {
        keys.push(factKeyFor(route, factId));
      });
    });
    return keys;
  }

  function timelineLaneHeaderNode(label, route, x, y, width) {
    return {
      uid: "timeline:header:" + route + ":" + slug(label),
      id: "timeline:header:" + route + ":" + slug(label),
      kind: "timelineLaneHeader",
      label: label,
      route: route,
      width: width,
      height: 14,
      x: x,
      y: y,
      searchText: route + " " + label
    };
  }

  function timelineGroupWidth(group) {
    var base = 268 + Math.max(group.events.length, group.facts.length) * 26;
    var textWidth = Math.max(
      timelineLongestTextWidth(group.decisions || [], 82, 58),
      timelineLongestTextWidth(group.facts || [], 78, 72),
      timelineLongestTextWidth(group.operations || [], 78, 72)
    );
    return clamp(Math.round(Math.max(base, textWidth)), 286, 640);
  }

  function timelineLongestTextWidth(items, maxChars, padding) {
    var longest = 0;
    items.forEach(function (item) {
      longest = Math.max(longest, String(item.summary || item.label || "").length);
    });
    return Math.min(longest, maxChars) * 6.4 + padding;
  }

  function timelineDecisionRows(group) {
    return (group.decisions || []).slice(0, 4);
  }

  function timelineDecisionStackHeight(decisionBlocks) {
    var height = 0;
    (decisionBlocks || []).forEach(function (block) {
      if (!block || !block.decision) return;
      height += 58;
    });
    return height;
  }

  function timelineFactNodeHeight(item, width) {
    return Math.max(26, timelineFactLineCount(item, width) * 16 + 10);
  }

  function timelineFactLineCount(item, width) {
    var description = String((item && (item.summary || item.label)) || "");
    var charsPerLine = Math.max(22, Math.floor((width - 48) / 6.4));
    return timelineEstimatedWrappedLineCount(description, charsPerLine);
  }

  function timelineEstimatedWrappedLineCount(text, charsPerLine) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return 1;
    var lineCount = 1;
    var used = 0;
    words.forEach(function (word) {
      var wordLength = word.length;
      if (word.length > charsPerLine) {
        if (used > 0) {
          lineCount += 1;
          used = 0;
        }
        lineCount += Math.floor((wordLength - 1) / charsPerLine);
        used = wordLength % charsPerLine;
        return;
      }
      var nextUsed = used === 0 ? wordLength : used + 1 + wordLength;
      if (nextUsed > charsPerLine) {
        lineCount += 1;
        used = wordLength;
        return;
      }
      used = nextUsed;
    });
    return Math.max(1, lineCount);
  }

  function timelineOperations() {
    return state.model && state.model.timelineView && state.model.timelineView.operations ? state.model.timelineView.operations : [];
  }

  function firstTimelineItemForCanvas() {
    var groups = timelineFeatureGroups();
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      var group = groups[groupIndex];
      if (group.decisions && group.decisions.length > 0) return group.decisions[0];
      if (group.facts && group.facts.length > 0) return group.facts[0];
      if (group.operations && group.operations.length > 0) return group.operations[0];
    }
    var operations = timelineOperations();
    if (operations.length > 0) return operations[0];
    var timeline = timelineItemsForCanvas();
    return timeline.length > 0 ? timeline[0] : null;
  }

  function timelineItemNode(item, overrides) {
    return {
      uid: overrides.uid || item.id,
      id: item.id,
      kind: "timeline",
      role: overrides.role,
      timelineKind: item.kind,
      timelineId: item.id,
      factKey: timelineFactKey(item),
      label: item.label,
      subtitle: timelineNodeSubtitle(item),
      summary: item.summary || "",
      route: overrides.route || item.route,
      width: overrides.width,
      height: overrides.height,
      x: overrides.x,
      y: overrides.y,
      item: item,
      searchText: timelineSearchText(item)
    };
  }

  function timelineScopedUid(route, id, role) {
    return "timeline:" + role + ":" + route + ":" + id;
  }

  function timelineFactKey(item) {
    var factId = item && item.related && item.related.facts ? item.related.facts[0] : "";
    return item && item.kind === "fact" && item.route && factId ? factKeyFor(item.route, factId) : "";
  }

  function timelineNodeSubtitle(item) {
    var parts = [];
    if (item.timestamp) parts.push(timelineDisplayDate(item.timestamp));
    parts.push(timelineKindLabel(item.kind));
    return parts.join(" · ");
  }

  function timelineNodeTooltip(node) {
    if (node.kind === "timelineFeature") return timelineFeatureTooltip(node);
    var item = node.item || node;
    return [timelineTooltipDateLabel(item), timelineKindLabel(item.kind), node.label, node.summary].filter(Boolean).join(" · ");
  }

  function timelineFeatureTooltip(node) {
    var start = timelineTooltipDateLabel({ timestamp: node.startTime || node.start });
    var end = timelineTooltipDateLabel({ timestamp: node.endTime || node.end });
    var range = start && end && start !== end ? start + " - " + end : (start || end);
    return [range, node.label].filter(Boolean).join(" · ");
  }

  function timelineTooltipDateLabel(item) {
    var date = timelineDisplayDate(item && item.timestamp);
    var time = timelineTimeLabel(item);
    return date && time ? date + " " + time : date;
  }

  function timelineGroupSearchText(group) {
    return [group.route, group.label, group.start, group.end, group.startTime, group.endTime]
      .concat((group.events || []).map(timelineSearchText))
      .concat((group.decisions || []).map(timelineSearchText))
      .concat((group.facts || []).map(timelineSearchText))
      .concat((group.operations || []).map(timelineSearchText))
      .join(" ");
  }

  function timelineSearchText(item) {
    var related = item.related || {};
    return [
      item.id,
      item.kind,
      item.label,
      item.summary,
      item.timestamp,
      item.status,
      item.route,
      item.source,
      (item.files || []).join(" "),
      (related.features || []).join(" "),
      (related.facts || []).join(" "),
      (related.adrs || []).join(" "),
      (related.sources || []).join(" ")
    ].join(" ");
  }

  function timelineKindColor(kind) {
    if (kind === "adr") return nodeColors.adr;
    if (kind === "fact") return nodeColors.fact;
    if (kind === "strategy") return nodeColors.group;
    if (kind === "handoff") return "var(--surface)";
    if (kind === "failure") return nodeColors.source;
    return nodeColors.more;
  }

  function timelineKindLabel(kind) {
    if (kind === "adr") return "ADR";
    return title(kind || "event");
  }

  function timelineRangeLabel(start, end) {
    if (!start && !end) return "";
    if (!end || start === end) return shortTimelineDate(start);
    return shortTimelineDate(start) + " - " + shortTimelineDate(end);
  }

  function timelineDisplayDate(value) {
    return shortTimelineDate(value);
  }

  function timelineTimeLabel(item) {
    if (!item || !item.timestamp) return "";
    var match = String(item.timestamp).match(/T(\d{2}:\d{2})(?::\d{2})?/);
    return match ? match[1] : "";
  }

  function shortTimelineDate(value) {
    if (!value) return "";
    var match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[2] + "/" + match[3] : String(value);
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
    state.selectedTimelineId = null;
    state.selectedTimelineArtifactId = null;
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
    drawCanvas();
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
    var timelineArtifact = selectedTimelineArtifactNode();
    if (state.leftView === "timeline" && timelineArtifact) {
      renderTimelineArtifactInspector(inspector, timelineArtifact);
      return;
    }
    var timelineItem = selectedTimelineItem();
    if (state.leftView === "timeline" && timelineItem) {
      renderTimelineInspector(inspector, timelineItem);
      return;
    }
    var node = selectedTreeNode();
    if (!node) {
      if (timelineItem) {
        renderTimelineInspector(inspector, timelineItem);
        return;
      }
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

  function renderTimelineInspector(inspector, item) {
    var relatedFactKeys = timelineInspectorRelatedFactKeys(item);
    var rows = [
      ["Kind", title(item.kind)],
      ["When", item.timestamp || ""],
      ["Status", item.status || ""],
      ["Route", item.route || ""],
      ["Source", item.source || ""],
      ["Files", (item.files || []).join(", ")],
      ["ADRs", item.related && item.related.adrs ? item.related.adrs.join(", ") : ""],
      ["Facts", timelineInspectorFactRowValue(item)]
    ];
    inspector.innerHTML = inspectorShellHtml(
      item.label,
      item.summary,
      '<dl class="kv">' + rows.filter(function (row) { return row[1]; }).map(function (row) {
        return '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      }).join("") + '</dl>' +
      relatedFactsHtml(relatedFactKeys)
    );
    bindInspectorControls(inspector);
    bindRelatedFactButtons(inspector);
  }

  function timelineInspectorFactRowValue(item) {
    if (isTimelineOperationItem(item)) return "";
    return item && item.related && item.related.facts ? item.related.facts.join(", ") : "";
  }

  function isTimelineOperationItem(item) {
    return Boolean(item && (item.kind === "handoff" || item.kind === "failure" || item.kind === "strategy"));
  }

  function renderTimelineArtifactInspector(inspector, node) {
    var relatedFactKeys = relatedFactKeysForArtifact(node.label, node.route);
    var rows = [
      ["Type", "File"],
      ["Route", node.route || ""],
      ["Related facts", relatedFactKeys.length ? String(relatedFactKeys.length) : "None"]
    ];
    inspector.innerHTML = inspectorShellHtml(
      timelineArtifactLabel(node.label),
      node.label,
      '<dl class="kv">' + rows.filter(function (row) { return row[1]; }).map(function (row) {
        return '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      }).join("") + '</dl>' +
      relatedFactsHtml(relatedFactKeys)
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
    var visibleKeys = visibleRelatedFactKeys(factKeys);
    var visibleCount = state.showAllRelatedFacts ? factKeys.length : Math.min(factKeys.length, limit);
    var remainingCount = factKeys.length - visibleCount;
    return '<div class="related-list"><div class="related-title">Related facts</div>' +
      visibleKeys.map(function (key) {
        var item = factItemByKey(key);
        var id = item ? item.fact.id : factIdFromKey(key);
        var displayId = compactFactId(id);
        var description = relatedFactTooltip(key, item);
        return '<button class="' + relatedFactClass(key, item) + '" type="button" data-related-fact-id="' + attr(id) + '" data-related-fact-key="' + attr(key) + '" title="' + attr(description) + '" aria-label="' + attr(description) + '">' + escapeHtml(displayId) + '</button>';
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
    updateRelatedFactHoverState(factKey);
  }

  function updateRelatedFactHoverState(factKey) {
    setCanvasFactHover("[data-fact-key]", factKey, "data-fact-key", "is-related-hover");
    setCanvasFactHover("[data-link-fact-key]", factKey, "data-link-fact-key", "is-hovered");
    setCanvasFactHover("[data-related-fact-key]", factKey, "data-related-fact-key", "is-hovered");
  }

  function setCanvasFactHover(selector, factKey, attribute, className) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (element) {
      element.classList.toggle(className, Boolean(factKey && element.getAttribute(attribute) === factKey));
    });
  }

  function activateRelatedFact(factKey) {
    if (!factKey) return;
    var item = factItemByKey(factKey);
    if (!item) return;
    if (state.leftView === "timeline") {
      activateRelatedTimelineFact(item);
      return;
    }
    cancelTreeAnimation();
    state.leftView = "features";
    state.showAllRelatedFacts = false;
    state.hoveredRelatedFactKey = null;
    state.selectedTimelineArtifactId = null;
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

  function activateRelatedTimelineFact(item) {
    cancelTreeAnimation();
    state.leftView = "timeline";
    state.selectedFeature = item.route;
    state.selectedId = null;
    state.selectedTreeUid = null;
    state.selectedTimelineId = timelineIdForFact(item.route, item.fact.id);
    state.selectedTimelineArtifactId = null;
    state.showAllRelatedFacts = false;
    state.hoveredRelatedFactKey = null;
    openInspector();
    ensureTimelineFactVisible(item);
    drawCanvas();
    centerTimelineFact(item, true);
    renderInspector();
    syncWorkspaceClass();
  }

  function ensureTimelineFactVisible(item) {
    if (!item || !item.route || !item.fact) return;
    var group = timelineFeatureGroups().find(function (candidate) { return candidate.route === item.route; });
    var facts = group && group.facts ? group.facts : [];
    var index = facts.findIndex(function (candidate) { return candidate.id === item.id; });
    if (index >= timelineFactDisplayLimit()) state.expandedTimelineFacts[item.route] = true;
  }

  function centerTimelineFact(item, animated) {
    var tree = state.visibleTree;
    if (!tree || !tree.nodes) return;
    var factKey = factKeyFor(item.route, item.fact.id);
    var node = tree.nodes.find(function (candidate) { return candidate.factKey === factKey; });
    if (!node) return;
    var canvas = document.getElementById("tree-canvas");
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, rect.width || 900);
    var height = Math.max(240, rect.height || 620);
    var target = centeredTreeTransform(node, width, height, animated ? timelineTargetScale() : state.transform.scale);
    if (animated) {
      animateTreeTransform(target, node, width, height);
      return;
    }
    state.transform.x = target.x;
    state.transform.y = target.y;
    state.transform.scale = target.scale;
    paintTreeFrame();
  }

  function timelineTargetScale() {
    return clamp(Math.max(state.transform.scale, 1), 0.75, 1.35);
  }

  function timelineIdForFact(route, factId) {
    return "timeline:fact:" + route + ":" + factId;
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
      drawCanvas();
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

  function visibleRelatedFactKeys(factKeys) {
    factKeys = factKeys || selectedRelatedFactKeys();
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
    if (state.leftView !== "features") return null;
    var tree = state.visibleTree;
    if (!tree || !state.selectedTreeUid) return null;
    return tree.byUid[state.selectedTreeUid] || null;
  }

  function selectedGraphNode() {
    if (!state.selectedId) return null;
    return state.model.nodes.find(function (node) { return node.id === state.selectedId; }) || null;
  }

  function selectedTimelineItem() {
    if (!state.selectedTimelineId) return null;
    return timelineItemById(state.selectedTimelineId);
  }

  function selectedTimelineArtifactNode() {
    if (state.leftView !== "timeline" || !state.selectedTimelineArtifactId || !state.visibleTree) return null;
    return state.visibleTree.byUid[state.selectedTimelineArtifactId] || null;
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
    var item = factItemByKeyMap()[key];
    if (item) return item;
    var parsed = parseFactKey(key);
    if (!parsed || !parsed.route) return null;
    return factItemByKeyMap()[factKeyFor(parsed.route, parsed.id)] || null;
  }

  function factItemByKeyMap() {
    if (state.factItemsByKey) return state.factItemsByKey;
    state.factItemsByKey = (state.model && state.model.facts ? state.model.facts : []).reduce(function (map, item) {
      map[factKeyFor(item.route, item.fact.id)] = item;
      return map;
    }, {});
    return state.factItemsByKey;
  }

  function relatedFactTooltip(key, item) {
    item = item || factItemByKey(key);
    var id = item ? item.fact.id : factIdFromKey(key);
    return item ? id + ": " + featureLabelForRoute(item.route) + ": " + assertion(item.fact) : id;
  }

  function compactFactId(id) {
    var match = String(id || "").match(/^([A-Z][A-Z0-9]*)-\d{8}T\d{6}Z-([a-z0-9]{4,})$/);
    if (!match) return String(id || "");
    var prefix = match[1];
    var suffix = match[2];
    return prefix + "-" + suffix;
  }

  function relatedFactClass(key, item) {
    item = item || factItemByKey(key);
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
    if (state.leftView === "timeline") return Boolean(selectedTimelineArtifactNode() || selectedTimelineItem() || selectedGraphNode());
    return Boolean(state.selectedTreeUid || selectedGraphNode());
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

  function leftViewButton(view, label) {
    return '<button type="button" class="segment-button' + (state.leftView === view && !state.query.trim() ? " is-active" : "") + '" data-left-view="' + attr(view) + '">' + escapeHtml(label) + '</button>';
  }

  function groupButton(groupBy) {
    return '<button type="button" class="segment-button' + (state.groupBy === groupBy ? " is-active" : "") + '" data-group-by="' + attr(groupBy) + '">' + escapeHtml(groupLabels[groupBy]) + '</button>';
  }

  function summaryLine(label, value) {
    return '<div class="summary-row"><span>' + escapeHtml(label) + '</span><span class="count">' + escapeHtml(value) + '</span></div>';
  }

  function headerFactCount(model) {
    if (state.leftView === "timeline") {
      var events = model.timeline ? model.timeline.length : 0;
      return events + " " + plural(events, "event", "events");
    }
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

  function searchResultsHtml(model) {
    var groups = groupedSearchResults(model);
    var visibleGroups = groups.filter(function (group) { return group.items.length > 0; });
    if (visibleGroups.length === 0) return '<div class="search-results"><div class="empty">No matching memory found.</div></div>';
    return '<div class="search-results">' + visibleGroups.map(function (group) {
      return '<div class="search-group">' +
        '<div class="label">' + escapeHtml(group.label) + '</div>' +
        '<div class="search-list">' + group.items.slice(0, 18).map(searchResultButton).join("") + '</div>' +
      '</div>';
    }).join("") + '</div>';
  }

  function groupedSearchResults(model) {
    var query = state.query.trim().toLowerCase();
    var groups = model.search && model.search.groups ? model.search.groups : [];
    if (!query) return groups;
    return groups.map(function (group) {
      return {
        kind: group.kind,
        label: group.label,
        items: group.items.filter(function (item) {
          return String(item.text || item.label || "").toLowerCase().indexOf(query) >= 0;
        })
      };
    });
  }

  function searchResultButton(item) {
    return '<button type="button" class="search-result" data-search-result="' + attr(item.id) + '">' +
      '<span class="search-result-title">' + escapeHtml(item.label) + '</span>' +
      '<span class="search-result-subtitle">' + escapeHtml(item.subtitle || item.kind) + '</span>' +
      '</button>';
  }

  function timelineSidebarHtml(model) {
    var timeline = model.timeline || [];
    if (timeline.length === 0) return '<div class="panel-stack"><div class="empty">No timeline events found.</div></div>';
    var byKind = timeline.reduce(function (counts, item) {
      counts[item.kind] = (counts[item.kind] || 0) + 1;
      return counts;
    }, {});
    var first = timeline[0];
    var latest = timeline[timeline.length - 1];
    return '<div class="panel-stack">' +
      '<div class="panel-section">' +
        '<div class="label">Timeline</div>' +
        '<div class="summary-list">' +
          summaryLine("Events", timeline.length) +
          summaryLine("First", first && first.timestamp ? first.timestamp : "") +
          summaryLine("Latest", latest && latest.timestamp ? latest.timestamp : "") +
        '</div>' +
      '</div>' +
      '<div class="panel-section">' +
        '<div class="label">Kinds</div>' +
        '<div class="timeline-legend">' +
          Object.keys(byKind).sort().map(function (kind) {
            return '<div class="timeline-legend-row"><span class="timeline-legend-swatch" style="background:' + attr(timelineKindColor(kind)) + '"></span><span>' + escapeHtml(timelineKindLabel(kind)) + '</span><span class="count">' + byKind[kind] + '</span></div>';
          }).join("") +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function activateSearchResult(id) {
    var item = searchItemById(id);
    if (!item) return;
    if (item.kind === "timeline" && item.timelineId) {
      activateTimelineItem(item.timelineId);
      return;
    }
    activateTarget(item.targetId || item.id, item.route);
  }

  function activateTimelineItem(id) {
    var item = timelineItemById(id);
    if (!item) return;
    cancelTreeAnimation();
    state.leftView = "timeline";
    state.selectedTimelineId = item.id;
    state.selectedTimelineArtifactId = null;
    state.selectedId = null;
    state.selectedTreeUid = null;
    openInspector();
    render();
  }

  function activateTimelineArtifact(id) {
    var node = state.visibleTree && state.visibleTree.byUid ? state.visibleTree.byUid[id] : null;
    if (!node) return;
    cancelTreeAnimation();
    state.leftView = "timeline";
    state.selectedFeature = node.route || state.selectedFeature;
    state.selectedTimelineId = null;
    state.selectedTimelineArtifactId = node.id;
    state.selectedId = null;
    state.selectedTreeUid = null;
    state.showAllRelatedFacts = false;
    state.hoveredRelatedFactKey = null;
    openInspector();
    drawCanvas();
    renderInspector();
    syncWorkspaceClass();
  }

  function activateTimelineFeature(route) {
    cancelTreeAnimation();
    state.leftView = "timeline";
    state.selectedFeature = route;
    state.selectedTimelineId = null;
    state.selectedTimelineArtifactId = null;
    state.selectedId = "feature:" + route;
    state.selectedTreeUid = null;
    openInspector();
    drawCanvas();
    renderInspector();
    syncWorkspaceClass();
  }

  function activateTarget(id, route) {
    cancelTreeAnimation();
    state.leftView = "features";
    if (route) state.selectedFeature = route;
    state.selectedTimelineId = null;
    state.selectedTimelineArtifactId = null;
    var factMatch = id && id.match(/^fact:(.+)$/);
    if (factMatch && state.selectedFeature) {
      var target = selectFactInTree(state.selectedFeature, factMatch[1]);
      if (target) {
        state.selectedId = target.id;
        state.expandedFactId = target.factId;
        openInspector();
        render();
        centerTreeNode(target.treeUid, true);
        return;
      }
    }
    var featureMatch = id && id.match(/^feature:(.+)$/);
    if (featureMatch) {
      state.selectedFeature = featureMatch[1];
      state.selectedId = featureTreeId(featureMatch[1]);
      state.selectedTreeUid = state.selectedId;
    } else {
      state.selectedId = id;
      state.selectedTreeUid = null;
    }
    openInspector();
    render();
  }

  function searchItemById(id) {
    var groups = state.model && state.model.search ? state.model.search.groups : [];
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      var item = groups[groupIndex].items.find(function (candidate) { return candidate.id === id; });
      if (item) return item;
    }
    return null;
  }

  function timelineItemById(id) {
    var timeline = state.model && state.model.timeline ? state.model.timeline : [];
    return timeline.find(function (item) { return item.id === id; }) || null;
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

  function hasIntersection(left, right) {
    var seen = {};
    (left || []).forEach(function (value) {
      seen[value] = true;
    });
    return (right || []).some(function (value) { return seen[value]; });
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
