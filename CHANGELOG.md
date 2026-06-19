# Changelog

## 2026-06-18

### Shared KB
- Barry Brain core is built on a portable Web Fetch API handler plus a BrainStore persistence interface so the same code can run on multiple runtimes and storage backends
- Brain v1 ships as a single Docker container backed by bun:sqlite with no external services and no new runtime dependencies
- Each Brain signs snapshots with its own Ed25519 keypair whose public-key fingerprint clients pin to verify snapshot signatures end-to-end without a central authority
- Brain conformance suite verifies that any deployment satisfies the vendor-neutral Brain contract via the barry-brain conformance command
- Shared KB intake batches are signed with a recursive stable-stringify canonical payload so the Ed25519 signature binds the full lesson and attestation contents; the same module is shared by the client and the Brain to prevent drift
- Barry shared KB client contributes via a local Ed25519 validator identity in .barry-cache/shared-kb/identity.json, anonymized lesson proposals queued to a repo-local outbox, and a signed intake batch POSTed to a Brain /v1/intake endpoint
- barry-cache kb propose and kb submit gate proposal creation on preview-only or share-enabled mode and submission to a Brain on share-enabled mode, reading the target from --brain or shared_kb.brain.url
- Shared KB brain descriptor is stored in .barry-cache/config.json as shared_kb.brain with url, scope (private or global), and optional trust_policy so a repo points Barry at a chosen Brain
- Shared KB harvest is gated on preview-only or share-enabled mode, and a successful finalize nudges the agent to run kb harvest only when sharing is enabled
- Shared KB attestations are signed outcome records (confirmed/contradicted/not_applicable x observed_success/observed_failure/static_review) that the Brain binds to their signing key by deriving validator_id and rejecting mismatches, so reputation cannot be stolen or fabricated
- Shared KB reputation computes lesson scores as a sigmoid of signed, evidence-weighted (observed_failure>observed_success>static_review), copied-evidence-discounted attestation contributions, and validator reputation as agreement with the resulting scores in a single pass
- Shared KB staged maturation promotes and demotes reviewed lessons to trusted only with enough independent confirmations across diverse contexts, a positive score, and a minimum observation window, and demotes to challenged on a credible observed_failure that drives the score net-negative; terminal statuses are never auto-changed
- barry-cache kb attest sends a signed outcome attestation for a consumed lesson to a Brain /v1/attest endpoint, gated on share-enabled mode (attestation-on-use)


## 2026-06-04

### Init Bootstrap
- barry-cache init adds to managed gitignore .barry-cache/ so repo-local Barry user config such as shared KB contribution mode is not committed

### Shared KB
- Shared KB snapshots generate manifest, manifest signature, lesson JSONL, revocation JSONL, and search index files for vendor-neutral static snapshot distribution to any static host or a Brain's /v1/snapshot endpoint
- Shared KB search defaults to trusted lessons while allowing reviewed lessons only through an explicit include-reviewed option
- Shared KB validation rejects revealing file paths, email addresses, secret-looking tokens, malformed records, and duplicate lesson IDs before publication
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
