---
id: ADR-0011
title: Interoperate with cq and retire the standalone global hive-mind
status: active
date: 2026-06-19
supersedes: [ADR-0007, ADR-0009, ADR-0010]
tags: [shared-kb, cq, interop, hive-mind, brain]
---

# ADR-0011: Interoperate with cq and retire the standalone global hive-mind

## Context

ADR-0007, ADR-0009, and ADR-0010 built Barry toward owning a *global* shared-KB commons: a
self-hostable Brain server (`brain/`), signed static-pack distribution, and a self-validating
trust engine (attestation + reputation + staged maturation). The north star was
`docs/superpowers/specs/2026-06-18-self-validating-agent-hive-mind-design.md`.

Two facts, established by review in June 2026, undercut that direction:

1. **A better-positioned project already occupies this space.** Mozilla's `cq`
   ("Stack Overflow for agents", `github.com/mozilla-ai/cq`) is an explicitly *open standard*
   for shared agent learning with a published JSON Schema (`schema/`), a documented REST contract
   (`GET/POST /api/v1/knowledge`, `data`-rooted `KnowledgeUnitList`), an MCP tool surface
   (`query`/`propose`/`confirm`/`flag`/`reflect`/`status`), Claude Code + OpenCode plugins, and a
   human-review UI. Its design independently converged on ours field-for-field
   (`insight{summary,detail,action}` ≈ our lesson; `confidence`/`confirmations`/`contributing_orgs`
   ≈ our scoring; `graduation_history` ≈ our maturation; "3 agents from 3 independent orgs > 800
   from 2" ≈ our independent-validator/copied-evidence rule). It carries Mozilla.ai distribution
   and Linux-Foundation-governed MCP.
2. **The hardest part of our bet is the part the field says is unsolved.** Automated, human-free
   validation of agent-harvested knowledge (poisoning, collusion, unreliable agent self-report)
   is an open research problem. Running a *production* global commons that depends on solving it
   is a large operational and reputational liability for a solo project, and duplicates cq.

Owning a rival global commons therefore means a cold-start network-effects war against a
Mozilla-backed open standard, on an unsolved trust problem, while operating a public service.
Barry's genuine, non-duplicated edge is elsewhere: **source-backed, validated, auditable**
context, a **structured** (not chat-scraped) harvest pipeline, and **cryptographically signed**
contributions.

## Decision

Stop building a standalone global commons. **Interoperate with cq** as a high-quality
contributor/consumer, keep only the pieces that are a genuine advantage over cq, and treat the
self-validation trust work as research rather than a running production system.

1. **Become cq-compatible.** Barry's own lesson format stays canonical; cq is reached through a
   **versioned adapter** (pinned to a cq schema version), never by coupling core to cq. Consume cq
   via its REST `GET /api/v1/knowledge` (or MCP `query`) and contribute via `POST /api/v1/knowledge`
   (or MCP `propose`), mapping Barry lesson ⇄ cq `knowledge_unit`.
2. **Carry forward four advantages, nothing else.**
   - *Source-backed provenance* — KEEP local. cq's `propose.json` has **no structured provenance
     field**, so on the cq path provenance rides as a prose note in `insight.detail` plus
     `created_by`. Structured provenance is preserved canonically in Barry's own lesson record.
   - *Structured harvest from finalize/failure/context records* (`shared-kb-harvest.ts`) — KEEP
     local as the feeder into cq `propose`.
   - *Local privacy sanitize / bias-to-drop* (redaction in `shared-kb.ts`, harvest checklist) —
     KEEP local; sanitize before anything leaves the machine.
   - *Ed25519 signing* (`shared-kb-identity.ts`, `shared-kb-intake.ts`, `shared-kb-attestation.ts`)
     — **cannot be carried to vanilla cq** (`propose.json` has no signature field; `confirm.json`
     is `unit_id`-only with `additionalProperties:false`). Signing is therefore retained only for
     **local outbox integrity** and for a future **Barry-aware brain**; it is not part of the cq
     contribution path. (Verified against cq `schema/*.json` during SP/Phase grounding, 2026-06-19.)
3. **Retire the global-commons machinery.** The Brain server (`brain/`), signed static-pack
   distribution (snapshot build in `shared-kb.ts`, `kb build`), and the running maturation engine
   (`brain/core/maturation.ts`) are removed from the shipped product. `kb submit`/`kb attest`
   retarget from a Barry Brain to cq (or are removed in favour of the cq contribute path).
4. **Delete the trust-validation research entirely.** `shared-kb-reputation.ts`, the maturation
   logic, attestation, and the Brain are removed outright — **no `barry-hive` research repo**, no
   continued work on outcome-grounded reputation. Git history is the only record. (Revised
   2026-06-19: the originally-planned research extraction was dropped at the owner's direction.)
5. **The hedge is the adapter, not a parallel server.** Keeping Barry's format canonical behind a
   versioned cq adapter is the insurance against cq churn or sunset — if cq changes or dies, point
   the adapter elsewhere. We do not keep a competing Brain running "just in case".
6. **The company/private tier is a deferred, explicit judgment call, not part of this decision.**
   Default is to use cq's organization tier. A private Barry Brain is reconsidered later *only* if
   we can state a one-sentence enterprise edge cq-org lacks (source-backed provenance + signed
   contributions + the review UI). Until then, the Brain is retired, not maintained.

The privacy opt-in model of ADR-0008 (default `local_only`, explicit `preview_only`/`share_enabled`
modes) is **unchanged and still in force**; this ADR does not supersede it.

## Consequences

Barry repositions from "another shared KB with its own Brain" to "the best local/org source-backed
memory layer, and the highest-quality signed, provenance-carrying contributor to the emerging open
commons." This resolves cold-start, the competitor, and the operate-a-commons burden in one move,
and frees the shipped product to focus on its real edge.

Costs and follow-ups:

- **Deleted code is real loss.** The hive-mind work validated the design (cq independently
  converged) and its reusable parts (harvest, sanitize, sign, provenance) are kept; the redundant
  parts (Brain, snapshot distribution, attestation/reputation/maturation) are deleted outright.
- **External dependency risk.** cq is a proof-of-concept; its schema will churn and Mozilla.ai
  may sunset it. Mitigated by the versioned adapter + canonical-local-format hedge.
- **cq contract limits (grounded against `schema/*.json`, 2026-06-19).** cq's remote REST API is
  only `GET`/`POST /api/v1/knowledge` (+ `GET /api/v1/users/me/api-keys`); `confirm`/`flag` are
  **local MCP tools, not REST endpoints**, and `propose.json` carries no signature/evidence/
  structured-provenance. Therefore the cq contribution path is **propose-only**: Barry contributes
  provenance-annotated lessons over REST and does **not** send attestations to cq (rich/signed
  attestation stays local / Barry-aware-brain). The consume adapter maps cq's authoritative fields
  (`domains`, `evidence.*`, `context.*`, `flags`), not the architecture-doc prose.
- **Supersession.** This ADR supersedes ADR-0007 (static-pack global storage/distribution),
  ADR-0009 (ship a self-hostable global Brain), and ADR-0010 (run a global self-validation engine);
  those are marked `superseded`. The portable-core and company-tier *ideas* from ADR-0009/0010 are
  carried forward only as the deferred judgment call in Decision §6. The hive-mind program spec
  (`HIVE_MIND_SPEC`) sub-projects SP3 (global Brain intake) and SP4 (global self-validation) are
  superseded for the shipped product; SP0–SP2 harvest/sanitize/sign work survives as the cq
  contributor pipeline.
- **Implementation is staged** in `docs/superpowers/plans/2026-06-19-cq-interop-pivot.md`: consume
  adapter → contribute adapter (provenance + signing) → retire Brain/maturation/snapshot →
  extract `barry-hive` research repo. Existing `brain/`, snapshot, maturation, reputation, and
  attestation facts stay `active` until their code is actually removed in those phases; each phase
  flips the corresponding facts to `superseded`/`deprecated` and adds cq-adapter facts.

Facts describing cq interoperability (the consume/contribute adapters, the lesson⇄knowledge_unit
mapping, provenance-on-contribution, the retirement of the global Brain/maturation/snapshot, and
the company-tier deferral) should reference this ADR.
