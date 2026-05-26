# Changelog

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
