# Changelog

## 2026-06-27

### Workspace Filtering
- workspace selection uses precedence explicit --workspace first, then --paths path inference, then task text inference, then no workspace; selected workspace routes receive a route/search boost, dependency routes receive a smaller boost, and unrelated global matches remain visible
- resume workspace ambiguity returns workspace_decision.status ambiguous with candidates and required_action instead of a context preview when the default require-when-ambiguous policy cannot choose a single workspace
- barry-cache workspace provides list and infer subcommands, and route/search/resume accept --workspace and --paths workspace hints that surface the structured workspace_decision in JSON output
- Generated Barry agent instructions tell agents to pass --paths when relevant files or directories are known, use Barry's selected workspace, and not guess when workspace_decision.status is ambiguous; agents should ask the user or rerun with --workspace <slug>
- barry-cache validate checks optional workspace registry shape, duplicate slugs, duplicate aliases, unknown routes, unknown dependencies, self-dependencies, invalid selection mode, no-match workspace paths, and recursive wildcard path prefixes without false no-match warnings; context-cache manifests also watch workspaces.json and the workspace schema


## 2026-06-25

### Shared KB
- barry-cache kb contribute posts each queued outbox lesson to cq POST /api/v1/knowledge as a propose request (domains<-tags, insight summary/detail/action, provenance plus applies_when/avoid_when prose appended to detail, created_by=validator id, and a structured barry:provenance extension with harvested/tool/evidence_class/observations metadata), gated on share-enabled, with --dry-run; cq propose carries no signature or evidence and Barry sends nothing signed (no local signing — see ADR-0014)


## 2026-06-23

### Context Loading
- bench run measures tokens saved and pack/fact recall over docs/context/benchmarks fixtures
- loadContext carries facts once at the top level instead of duplicating them under feature, shrinking raw load output about 43% on Barry's own context
- load and resume select context within a token budget defaulting to 2000 per pack (DEFAULT_LOAD_BUDGET) and trimmed so the full emitted output fits; --budget overrides and --expand all returns the full pack

### Init Bootstrap
- Generated Barry agent instructions explain that load and resume return a budgeted slice by default (~2000 tokens/pack) and tell agents to restore dropped facts with --expand <id> or --expand all


## 2026-06-20

### Context Authoring
- barry-cache validate drift detection resolves IDMAP path values written as markdown code spans (e.g. `- `ID` = `path``) by taking the first backtick-quoted token as the source path, so an existing target no longer false-positives as a missing source file; bare unquoted values are still used verbatim

### Shared KB
- barry-cache kb search --source cq queries a configured cq endpoint via GET /api/v1/knowledge through a versioned adapter (CQ_SCHEMA_VERSION), sending each required domain filter (--domains or shared_kb.cq.domains) as a repeated domains query parameter, then mapping cq knowledge_units to Barry search items and scoring them by the free-text query locally; rejects a query with no searchable term (no word of 3+ characters) so it never silently returns the whole domain; gated on share-enabled mode and erroring clearly on a non-JSON response


## 2026-06-19

### Init Bootstrap
- barry-cache validate reports context drift as non-failing warnings: provenance rot (a fact src resolved via IDMAP token or path points to a missing file) and stale open-question/risk facts older than staleAfterDays (default 180), with validate --strict (and doctor --strict) turning warnings into a non-zero exit for CI; validateProject takes injectable now and staleAfterDays

### Shared KB
- cq endpoint descriptor is stored in .barry-cache/config.json as shared_kb.cq with url, optional api_key_ref (env:NAME), and optional domains, and is preserved when the contribution mode is rewritten
- barry-cache kb cq login stores the cq API key in a git-ignored owner-only .barry-cache/cq-credentials.json (separate from config.json), records the cq endpoint (default https://api.cq.exchange — the hosted REST API; cq.exchange itself is the web UI — with --url to override), and enables share-enabled; the key is read from --api-key, CQ_API_KEY, or stdin; resolution prefers an api_key_ref env over the stored key; kb cq logout removes the key and sets local-only


## 2026-06-18

### Shared KB
- barry-cache kb propose gates lesson proposal creation on preview-only or share-enabled mode, queuing the validated lesson to the repo-local outbox for later contribution
- Shared KB harvest is gated on preview-only or share-enabled mode, and a successful finalize nudges the agent to run kb harvest only when sharing is enabled
- barry-cache kb harvest --source context bootstrap-harvests the existing context backlog (active decision facts, active ADRs, recorded validation failures) into sanitization candidates, excluding implemented/test facts, superseded records, and src file pointers, then flows through the agent-in-the-loop propose path
- barry-cache kb propose supports the lesson, anti_pattern, and decision_pattern kinds via --kind so harvested decisions and failures keep their taxonomy


## 2026-06-16

### Context Authoring
- barry-cache validate checks duplicate feature fact IDs, fact enum and timestamp fields, malformed IDMAP and KG rows, and unresolved bare source IDs
- barry-cache feature new scaffolds README.md, IDMAP.md, KG.adj, and FACTS.jsonl for a new feature pack with dry-run support and overwrite refusal
- barry-cache fact draft prints or appends schema-checked JSONL fact rows with explicit --write, generated collision-resistant IDs from --prefix, duplicate-ID refusal, and source-ID validation
- Generated Barry agent instructions describe fact draft as an optional schema-checked authoring guardrail while preserving direct FACTS.jsonl edits and validation as the canonical workflow


## 2026-06-04

### Init Bootstrap
- barry-cache init adds to managed gitignore .barry-cache/ so repo-local Barry user config such as shared KB contribution mode is not committed

### Shared KB
- Shared KB lesson validation rejects revealing file paths, email addresses, and secret-looking tokens in lesson text, so a lesson is sanitized before it is queued to the outbox or contributed to cq
- Shared KB contribution mode is stored in .barry-cache/config.json as repo-local user config with local_only, preview_only, or share_enabled values
- barry-cache kb sharing manages shared KB contribution status and set commands using local-only, preview-only, and share-enabled CLI mode names


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
