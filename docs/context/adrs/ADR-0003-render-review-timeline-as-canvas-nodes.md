---
id: ADR-0003
title: Render review timeline as canvas nodes
status: active
date: 2026-05-26
supersedes: []
tags: [review, timeline, ui]
---

# ADR-0003: Render review timeline as canvas nodes

## Context

The review interface already uses the main canvas for inspectable memory nodes. Timeline was initially considered as a left-sidebar view, but that makes chronological development history feel secondary and visually separate from the existing node-review workflow.

The interface is intentionally zero-build for now: HTML, CSS, and browser JavaScript are shipped as static assets from the package. The timeline implementation therefore needs to reuse the existing canvas, pan, zoom, selection, and inspector mechanics without introducing a frontend build step.

## Decision

Render the Timeline view on the main review canvas as a feature-centered journey view. Feature context packs render as top-level horizontal bars. Decisions render under the feature bars using linked ADRs and decision facts. Implemented facts render as bullet rows under the decisions. Operational records such as handoffs, failures, and strategies stay in a separate lower lane.

The left sidebar keeps the Features and Timeline switcher, but Timeline mode uses the sidebar for compact summary and legend metadata rather than a scrollable event list. Selecting a timeline decision, fact bullet, or operational event opens the inspector for that timeline event and keeps the user in timeline mode without panning or zooming the canvas. Search stays grouped across object types; selecting a timeline search result switches to the timeline canvas and selects the matching rendered node when available.

## Consequences

Timeline review now explains development in terms of feature, why, and what: the feature bar anchors the work, decision nodes explain the motivation and tradeoffs, and fact bullets show what was implemented. This keeps chronological implementation history in the primary workspace instead of burying it in sidebar navigation.

Decision nodes must reserve vertical space before fact bullets render, otherwise ADR and decision cards blend with implementation bullets as feature packs accumulate more records.

The current zero-build implementation keeps more behavior in plain JavaScript than a component-based frontend would. If the review UI grows into a larger application, the asset split and server boundary can remain while the client implementation is revisited.
