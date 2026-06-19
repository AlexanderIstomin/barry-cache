# cq Interop Pivot — Roadmap

> **Status:** Approved direction (see [ADR-0011](../../context/adrs/ADR-0011-interoperate-with-cq-and-retire-the-standalone-global-hive-mind.md)).
> This is a **roadmap** (phase-level), not a bite-sized implementation plan. Each phase gets its
> own executable plan file before it is built. Phase 1's plan is
> `docs/superpowers/plans/2026-06-19-cq-consume-adapter.md`.

**North star:** Barry becomes *"the best local/org source-backed memory layer, and the
highest-quality provenance-carrying contributor to the emerging open commons (cq)."*
We interoperate with Mozilla's `cq` instead of running a rival global commons and keep four
differentiated advantages.

> **Update:** local Ed25519 signing was later dropped as unused residue (see
> [ADR-0014](../../context/adrs/ADR-0014-remove-unused-hive-mind-signing-residue-and-simplify-validator-identity.md)),
> and the standalone trust-validation research repo was cancelled rather than spun out (see ADR-0011).
> Contributions are plain provenance-annotated lessons; the validator identity is a random `created_by` id.

**Supersedes:** ADR-0007, ADR-0009, ADR-0010; hive-mind spec sub-projects SP3 (global Brain
intake) and SP4 (global self-validation). Privacy opt-in (ADR-0008) is unchanged.

---

## cq integration surface (the contract we target)

Pin everything below behind a versioned adapter (`CQ_SCHEMA_VERSION`); never couple core to cq.
**Authoritative source = cq's published JSON Schemas** (`schema/*.json`), NOT the architecture-doc
prose (they diverge — the prose lists fields like `domain`/`kind`/`status`/`confidence`/
`proposer_did` that do not exist in the schema).

- **REST:** `GET /api/v1/knowledge?domains=<csv>` → `data`-rooted list (`next_cursor` when paged);
  `POST /api/v1/knowledge` per `propose.json` (single object, flagged for human review);
  confirm per `confirm.json`. **MCP tools (alt transport):** `query`, `propose`, `confirm`,
  `flag`, `reflect`, `status`.
- **`knowledge_unit.json`** — required `[id, domains, insight]`. Fields: `id` (`ku_[0-9a-f]{32}`),
  `version`, `domains: string[]`, `insight{summary,detail,action}` (all required),
  `context{languages[],frameworks[],pattern}`, `evidence{confidence 0–1, confirmations,
  first_observed, last_confirmed}`, `tier` (`local`|`private`|`public`), `created_by`,
  `superseded_by`, `flags[]` (`reason`: stale|incorrect|duplicate). **No `kind`/`status`/`severity`.**
- **`propose.json`** (contribute) — required `[domains, insight]`; allowed: `domains`, `insight`,
  `context`, `created_by`. **No id (server-assigned), no evidence, no signature, no batch.**
- **`confirm.json`** (attest) — `{ unit_id }` only, `additionalProperties: false`. Negative
  signal = `flag` (`reason`).

### Barry lesson ⇄ cq mapping (canonical, used by every phase)

Consume (`knowledge_unit` → Barry search item):

| cq field | Barry search item |
|---|---|
| `insight.summary` | `title` |
| `insight.detail` + `insight.action` | `summary` |
| `domains[]` | `tags` |
| `evidence.confidence` (0–1) | `confidence` band (≥.66 high / ≥.33 med / low) |
| `evidence.confidence` ≥ .6, else; `flags[]` non-empty | `status` trusted / reviewed / challenged |
| `evidence.last_confirmed` ?? `first_observed` | `updated_at` |
| (no cq `kind`) | `kind` = `lesson` |

Contribute (Barry lesson → `propose.json`):

| Barry `SharedKbLesson` | cq propose |
|---|---|
| `title` | `insight.summary` |
| `problem` + `why` + **provenance note** | `insight.detail` (only schema-legal home for provenance) |
| `recommendation` | `insight.action` |
| `tags` | `domains[]` |
| `applies_when`/`avoid_when` → `context.pattern`; languages/frameworks if known | `context` |
| validator id / repo handle | `created_by` |

**Limitations forced by the schema (see Phase 2):** cq propose has **no field for an Ed25519
signature or structured provenance/evidence**, and `confirm` is `unit_id`-only. So signing and
rich attestation (confidence/context/evidence_type/contradiction-with-detail) **cannot be carried
to vanilla cq** — they survive only locally or against a Barry-aware brain. Provenance degrades to
prose-in-`detail` + `created_by`.

---

## Disposition (what each existing module becomes)

Derived from the full inventory. KEEP = stays in shipped Barry; ADAPT = retargeted to cq;
DROP = deleted outright (no research repo — owner dropped the hive-mind entirely 2026-06-19).

| Module / asset | Verdict | Phase |
|---|---|---|
| `src/core/shared-kb-harvest.ts` (structured harvest) | **KEEP** — feeds cq propose | — |
| `src/core/shared-kb.ts` lesson types + validation + **redaction** | **KEEP** | — |
| `src/core/shared-kb.ts` snapshot build (`buildSharedKbSnapshot*`, manifest sign) | **DROP** | 3 |
| `src/core/shared-kb-proposal.ts` (proposal/outbox) | **KEEP** (output mapped to cq) | 2 |
| `src/core/shared-kb-identity.ts` + `shared-kb-intake.ts` (stable-stringify; Ed25519 since removed) | **KEEP** identity (random `created_by` id) — signing dropped, see ADR-0014 | 2 |
| `src/core/shared-kb-attestation.ts` (signed outcomes) | **ADAPT** → cq `confirm`/`flag` | 2 |
| `src/core/shared-kb-config.ts` (brain descriptor) | **ADAPT** → cq endpoint descriptor | 1 |
| `src/core/shared-kb-brain-client.ts` (Brain HTTP client) | **ADAPT** → cq client (or replace) | 1–2 |
| `src/core/shared-kb-reputation.ts` (reputation scoring) | **DROP** | 3 |
| `brain/**` (server, store, router, runtime, cli, conformance, Dockerfile, tests) | **DROP** (global); company tier deferred | 3 |
| `brain/core/maturation.ts` (staged maturation) | **DROP** | 3 |
| `kb build` / `kb submit`→own-brain / `kb attest`→own-brain (CLI) | **ADAPT/DROP** | 2–3 |
| `docs/brain-self-host.md`, `docs/shared-kb-distribution.md` | **DROP/REWRITE** for cq | 3 |
| New: `src/core/cq-adapter.ts` (map + transport) | **CREATE** | 1 |

---

## Critical path

### Phase 1 — cq consume adapter (additive, zero deletion)

**Goal:** `barry-cache kb search --source cq --query "..."` returns cq knowledge units mapped to
Barry search items, through a versioned, fixture-tested adapter.

**Deliverables:**
- `src/core/cq-adapter.ts`: `CQ_SCHEMA_VERSION`, `parseKnowledgeUnitList(json)` (unwrap `data`),
  `cqUnitToSearchItem(unit)` → `SharedKbSearchItem`, `fetchCqKnowledge({endpoint, domains, apiKey})`.
- `shared-kb-config.ts`: cq endpoint descriptor in `.barry-cache/config.json`
  (`shared_kb.cq = {url, api_key_ref}`), read alongside the existing brain descriptor.
- `src/cli.ts`: `kb search --source cq` routes to the adapter; remote-mode gating reuses
  `assertRemoteSharedKbSearchAllowed`.

**Tests:** `tests/cq-adapter.test.ts` (response fixtures: `KnowledgeUnitList`, empty, malformed,
pagination `next_cursor`); extend `tests/cli-kb.test.ts` for `--source cq`.

**Exit criteria:** all tests green; `kb search --source cq` works against a fixture server; no
existing behavior changed. **Risk:** low. **Depends on:** nothing.

**Detailed plan:** `docs/superpowers/plans/2026-06-19-cq-consume-adapter.md`.

### Phase 2 — cq contribute adapter (provenance + signing)

**Goal:** queued Barry proposals map to cq `knowledge_unit` and POST to cq, carrying source
provenance and an Ed25519 signature; outcome attestations route to cq `confirm`/`flag`.

**Deliverables:**
- `cq-adapter.ts`: `lessonToCqUnit(lesson, {provenance})`, provenance note builder, request signer.
- Retarget `shared-kb-brain-client.ts` (or new `cq-client.ts`) to `POST /api/v1/knowledge` and the
  confirm/flag path; keep the harvest → propose → outbox → sign pipeline intact.
- `src/cli.ts`: `kb contribute` (or retargeted `kb submit`) and retargeted `kb attest`; gated by
  `share_enabled` exactly as today.

**Tests:** mapping/signing/provenance fixtures; CLI gating tests. POST is "flagged for human
review" on cq, so live calls are low-risk; default to fixture tests + a `--dry-run`.

**Exit criteria:** a sanitized, signed, provenance-bearing lesson round-trips Barry→cq in dry-run
and against a fixture server. **Risk:** medium. **Depends on:** Phase 1.

### ⮕ Decision gate — company/private tier

Before Phase 3, decide consciously (ADR-0011 §6): **drop the private Brain** (default; use cq's
org tier) **or keep it as "cq-org, but auditable"** (only if a one-sentence enterprise edge over
cq-org holds: source-backed provenance + signed contributions + review UI). Record the outcome as
a fact + short ADR if "keep". Default assumption for Phase 3 below: **drop**.

### Phase 3 — retire the global Brain, maturation, snapshot

**Goal:** remove the standalone global-commons machinery now that cq replaces it.

**Deliverables (deletions/edits):**
- Delete `brain/**` (all `brain/core/*`, `brain/http/*`, `brain/runtime/*`, `brain/cli.ts`,
  `brain/conformance/*`, `brain/Dockerfile`, `brain/tests/*`).
- `shared-kb.ts`: remove snapshot build + manifest signing exports; keep lesson types, validation,
  redaction, search-item helpers.
- `src/cli.ts`: remove `kb build`; finalize the `kb submit`/`kb attest` retarget; drop dead imports.
- Docs: delete or rewrite `docs/brain-self-host.md` and `docs/shared-kb-distribution.md` for cq.
- `package.json`: drop brain-related scripts if any.

**Memory updates:** flip brain/maturation/snapshot/intake-to-own-brain facts in
`features/shared-kb/FACTS.jsonl` to `superseded`/`deprecated`; add cq-adapter `implemented` facts
referencing `CQ_INTEROP_ADR`; prune obsolete IDMAP tokens. Run `barry-cache validate`.

**Exit criteria:** repo builds + tests green with no `brain/` and no snapshot path; `validate`
clean. **Risk:** high (deletion) — gated by Phases 1–2 shipping the replacement. **Depends on:**
Phases 1–2 + decision gate.

### Phase 4 — ~~extract `barry-hive` research repo~~ (CANCELLED)

**Cancelled 2026-06-19 at owner's direction:** there is no `barry-hive` repo and no continued
trust-validation research. `shared-kb-reputation.ts` and the maturation logic are **deleted
outright in Phase 3** (git history is the only record). The hive-mind spec is marked superseded in
place. Nothing remains to extract.

---

## Parallel independent tracks (no dependency on 1–4)

### Track A — AGENTS.md adapter collapse — ✅ DONE (ADR-0012)

`AGENTS.md` is now the canonical managed block; CLAUDE.md/GEMINI.md/copilot/cursor are thin
managed-block stubs that point to it; `llms.txt` stays an index. The duplicate `adapterFile`
generator is gone. The **MCP client** sub-part was intentionally skipped (CLI-first; AGENTS.md
convergence is the adapter-killer, not MCP).

### Track B — memory drift-detection — ✅ DONE (ADR-0013)

`validate` reports provenance rot (a fact `src` resolving via IDMAP/path to a missing file) and
stale `open-question`/`risk` facts (> `staleAfterDays`, default 180) as non-failing warnings;
`validate --strict` (and `doctor --strict`) gate CI on them. The git-mtime "untouched while
sources changed" check and the unresolved-`challenge` surfacing remain possible future work.

---

## Sequencing summary

1. **Phase 1** (consume) → **Phase 2** (contribute) → **decision gate** → **Phase 3** (retire
   the hive-mind outright). Phase 4 is cancelled. This order ensured the cq replacement shipped
   *before* anything was deleted.
2. **Track A** and **Track B** run anytime in parallel; they raise core-product value
   independently and are good "between phases" work.
3. Each phase ends with `barry-cache validate` clean and a fact/ADR update reflecting reality.
