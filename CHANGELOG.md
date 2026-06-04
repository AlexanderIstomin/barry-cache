# Changelog

## 2026-05-27

### Review Interface
- Review timeline validation failures surface validation failure events and follow-up handoff fix links through timeline related challenge and fix arrays while grouping linked failures with feature operations
- Review timeline decision lane promotes ADR cards only from decision facts while implemented-fact ADR references remain related links on fact timeline items
- Timeline related fact navigation centers a visible representative ADR or decision node when a clicked related fact has no standalone rendered timeline fact node


## 2026-05-26

### Changelog Generation
- Barry changelog command generates Markdown changelog output from implemented timeline facts without writing files by default
- Barry changelog write mode refuses to overwrite an existing changelog unless --rewrite is provided
- Barry changelog rewrite mode replaces the target changelog with the full generated changelog when --rewrite is explicit
- Barry changelog file-write flags treat --write and --rewrite as mutually exclusive sufficient modes for writing changelog output to a file
- Barry changelog since mode filters generated entries on or after the --since date for preview output or --write append output
- Barry changelog existing-file safety requires --rewrite to replace an existing changelog file or --write --since YYYY-MM-DD to append filtered entries
- Barry changelog append mode appends since-filtered generated changelog sections to an existing changelog with --write --since without duplicating the top-level Changelog heading
- barry-cache npm package publishes and links CHANGELOG.md through package files and a top-level README changelog link for npmjs visibility

### Init Bootstrap
- initProject skips adding devDependency when package name is barry-cache
- Barry canonical context lives in docs/context/
- Generated Barry agent instructions recommend ISO 8601 fact updated_at timestamps so same-day review timeline ordering can be preserved
- Generated Barry agent instructions recommend collision-resistant timestamp/hash fact IDs while allowing dense review UI to display compact labels

### Review Interface
- Review server serves zero-build review UI assets through serve-handler
- Review UI assets live under src/core/review-ui and are copied to dist/review-ui during build
- Review search model groups results across features, facts, ADRs, sources, entities, and timeline events
- Review timeline model includes ADR, fact, handoff, failure, and strategy events with related feature, fact, ADR, and source links
- Review timeline view model groups feature spans, linked decisions, implemented facts, and operational events for canvas rendering
- Timeline item selection opens the inspector without auto-centering or zooming the timeline canvas
- Timeline date guides display bold date labels at the top of the main timeline canvas
- Timeline canvas nodes reuse feature-view colors and expose full-row clickable fact bullets with hover descriptions
- Timeline canvas groups display Feature, Decisions, Implemented, and Artifacts lane headers with group-level implemented and artifact lists
- Timeline decision blocks display decision nodes without nested fact or artifact lists while handoff nodes use compact dates with time only in tooltips
- Timeline artifact rendering uses compact non-ADR artifact rows with basename labels and full-path tooltips
- Timeline canvas renders without timeline link lines while displaying all implemented fact descriptions with wrapped text
- Review timeline view defaults to timeline mode with group-level deduplicated non-ADR artifacts and artifact-only expandable more controls
- Review timeline feature groups sort chronologically by first dated event so left-to-right canvas order follows implementation time with undated groups last
- Review timeline feature groups preserve full timestamp sort keys while displaying compact dates so same-day feature ordering remains chronological
- Timeline related fact chips highlight and navigate timeline facts without switching the left view to Features; clicks select and pan to the matching timeline node
- Review canvas gestures support trackpad wheel panning, slower pinch zoom, date-adjacent tooltip times, and safer wrapped timeline fact row spacing
- Review timeline related facts support 20-item implemented fact truncation, animated timeline related-fact centering, cached related fact lookup, and hover updates without full canvas redraws
- Review operational timeline records link and render handoffs, failures, and strategies inside their related feature timeline groups by matching touched files to feature facts and ADR sources
- Timeline artifact and handoff inspectors show related facts as the standard colored fact chips while selected artifact rows use text emphasis and handoff cards use wider summary text
- Timeline decision lane deduplicates ADR-linked decision facts from decision cards and surfaces them as related fact chips on the selected ADR inspector instead
- Review feature cards use a muted dusty rose background instead of the previous brown and green feature colors so feature cards remain distinct from fact nodes
- Review operational timeline records infer and stack fileless handoffs by ranking summary evidence to a single strongest feature while standalone operation cards stack vertically instead of sharing one row
- Timeline handoff inspector omits the raw Facts metadata row for handoff, failure, and strategy records because related facts are already shown as colored chips
- Review related fact chips display long timestamp/hash fact IDs in compact prefix-hash form such as REV-a8f3 while preserving full IDs in data attributes and tooltips
- Review canvas wheel controls pan and zoom with plain wheel for vertical canvas pan, Shift+wheel for horizontal canvas pan, and Ctrl or Meta+wheel for zoom
