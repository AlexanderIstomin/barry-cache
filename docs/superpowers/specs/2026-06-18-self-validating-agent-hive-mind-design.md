# Self-Validating Agent Hive-Mind — Program Design

**Date:** 2026-06-18
**Status:** Approved design (program level); implemented per sub-project specs/plans.
**Supersedes (on SP4 delivery):** the human-review trust gate of ADR-0007 and the access-reciprocity stance of ADR-0008. See [ADR impact](#adr-impact).

> This is a **program design**, not a single implementation plan. The system is too large
> for one plan, so it is decomposed into sub-projects (SP0–SP4). Each sub-project gets its
> own spec → implementation plan → build cycle. This document is the shared north star.

---

## 1. Vision

A distributed hive mind where AI coding agents **harvest** knowledge from their real work,
**analyze and validate** it without a human moderator, and continuously **improve a shared
knowledge base** — with near-zero ongoing maintenance and a self-correcting trust model.

The same machinery serves two deployments from one codebase:

- A **global** public KB (the open commons).
- A **company/private** KB — a self-hosted "brain" that a company's Barry instances point at
  exclusively, with its own data and trust policy.

## 2. Goals and non-goals

**Goals**

- Agents contribute lessons automatically as a byproduct of finishing tasks.
- Validation is automated (no per-submission human review) and self-correcting.
- Privacy-first: nothing private leaves a machine; leaks are treated as unrecoverable.
- Vendor-independent: the "brain" is a contract, not a specific cloud product.
- Net token-positive for consumers; reciprocity without a cold-start wall.

**Non-goals (YAGNI for v1)**

- No tokens, cryptocurrency, payments, or on-chain anything.
- No recursive EigenTrust-style global trust iteration in v1 (single-pass reputation).
- No human moderation queue as the trust gate (it is explicitly replaced).
- No federation UI in v1 (the contract is federation-ready; only single-brain is exposed).
- No live "social" features (live votes, gamified leaderboards) beyond what scoring needs.

## 3. Locked design decisions

| Dimension | Decision |
|---|---|
| Validation basis | Outcome-grounded **attestation/voting** (not reproduction, not pure LLM-judge) |
| Harvest model | **Auto-harvest** from agent runs, gated by a novelty/reuse/confidence scorer |
| Sybil defense | **Earned reputation + intake rate-limits** (no real-identity requirement on the global brain) |
| Promotion gate | **Staged maturation** (submitted → reviewed → trusted) with contradiction-driven demotion |
| Privacy gate | **Regex + LLM sanitizer + local hold**, biased to drop when uncertain |
| Brain infrastructure | **Live Cloudflare Workers + D1** reference impl; **signed static snapshots** for distribution |
| Brain topology | **Isolated now, federation-ready contract** (one brain per repo; contract supports an ordered list later) |
| Incentive model | **Soft reciprocity + reputation-as-access** (no hard ratio gate) |

## 4. Architecture

### 4.1 Data flow

```
┌─ LOCAL (each Barry instance / agent) ──────────────────────────────┐
│ 1. Agent finishes task  → finalize(success) / failure record        │
│ 2. HARVEST    auto-extract candidate lesson from run + outcome      │
│ 3. GATE       novelty/reuse/confidence scorer (extends              │
│               shouldQuerySharedKb) — discard low-value locally      │
│ 4. SANITIZE   regex scrub → LLM abstract+flag → drop/hold if risky  │
│ 5. OUTBOX     sign proposal + outcome-grounded attestation          │
│               (local Ed25519 validator identity); held locally;     │
│               sharing mode (local/preview/share-enabled) gates send │
└────────────────────────────┬───────────────────────────────────────┘
                             │  daily signed batch (share-enabled only)
┌─ BRAIN (vendor-neutral contract; reference = Cloudflare Worker+D1) ─┐
│ 6. INTAKE     cheap validate (schema, redaction, sig); rate-limit   │
│               per-validator/IP/global (+optional PoW) → quarantine  │
│ 7. INGEST     verify sigs + dedup/merge near-duplicate lessons → D1 │
│ 8. SCORE      reputation-weighted, outcome-grounded, copied-discount│
│ 9. MATURE     staged state machine; contradiction → demote/revoke   │
│10. REPUTATION recompute validator reputation = agreement-w/-outcome │
│11. PUBLISH    regenerate signed static snapshot (manifest+sig+index)│
│               to R2/Pages for cheap, offline-capable distribution   │
└────────────────────────────┬───────────────────────────────────────┘
                             │
┌─ CONSUME (any Barry instance) ─────────────────────────────────────┐
│12. kb search (profitability-gated): default=trusted; advisory tiers │
│    behind flags; remote access gated on share-enabled (reciprocity);│
│    using a result triggers an outcome attestation back to the brain │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 The Brain Provider contract (vendor independence)

The brain is defined by a small, documented **HTTP contract** plus a published
**conformance test suite**. Barry talks to any conforming brain through one
transport-agnostic client; no cloud product is hardcoded.

Endpoints (v1):

- `POST /v1/intake` — submit a signed daily batch (lessons + attestations).
- `GET  /v1/search?q=...&tier=trusted|reviewed` — ranked results.
- `GET  /v1/snapshot` — signed static pack (`manifest.json`, `manifest.sig`, indexes, JSONL).
- `POST /v1/attest` — submit an outcome attestation for a consumed lesson.
- `GET  /v1/lesson/:id` — lesson record + maturation state + score.
- `GET  /healthz` — liveness.

Reference implementations shipped:

1. **Cloudflare Workers + D1** — the public global brain and cloud-hosted company brains.
2. **Self-hostable server (Bun + SQLite)** — single binary/container so a company is never
   forced onto Cloudflare. A read-only brain may even be a static snapshot bucket.

Brain descriptor in repo config (generalizes Plan A/B `shared_kb.remote`):

```jsonc
{
  "shared_kb": {
    "contribution": "share_enabled",
    "brain": {
      "url": "https://kb.acme-internal.example.com",
      "scope": "private",          // "private" | "global"
      "auth": { "type": "bearer", "ref": "env:ACME_KB_TOKEN" },
      "trust_policy": "company"    // see §4.4
    }
  }
}
```

"Use only that KB" = a single `private` brain; the instance never contacts the global one.
The contract permits an ordered brain list for future federation, but v1 config exposes one.

### 4.3 Trust state machine (the self-validating heart)

| State | Reached when | Visible in search |
|---|---|---|
| `submitted` | passed local sanitize + intake cheap-validation | no |
| `reviewed` | passed automated quality gate (schema complete, redaction clean, LLM-judge soundness/safety rubric) | only with `--include-reviewed` |
| `trusted` | ≥N **independent** validators (low correlation) × ≥M **distinct context clusters** × outcome-grounded `observed_success` × net-positive reputation-weighted score × **min observation window** × **no unresolved high-confidence contradiction** | yes (default) |
| `challenged` → `deprecated`/`revoked` | a credible `observed_failure`/`contradicted` crosses a threshold → **demote** (never silently retain) | no / advisory |

Existing schema already supports the terminal/transition statuses
(`submitted`, `quarantined`, `reviewed`, `trusted`, `challenged`, `deprecated`, `revoked`,
`superseded`) and `supersedes` — the engine drives transitions between them.

**Anti-poisoning properties** (what replaces the human gate):

- Fresh sybils carry ≈0 reputation, so flooding fake confirmations cannot move the score —
  this is why "earned reputation + rate-limits" was chosen over zero-cost voting.
- Correlated/co-submitting validators are discounted toward one effective vote
  (copied-evidence multiplier, per Plan A).
- `static_review` (opinion) is weighted far below `observed_success`/`observed_failure`.
- Reputation is earned by agreeing with **eventual outcomes, not the crowd**, so a collusion
  ring that upvotes junk loses reputation when reality contradicts it.
- Demotion-on-contradiction makes the system self-correcting, not merely self-promoting.

### 4.4 Trust policy is per-brain, not hardcoded

Maturation thresholds and sybil rules are **brain configuration**:

- `trust_policy: "global"` — strict: earned reputation, sybil/rate-limit defense, full
  independence/diversity/window thresholds.
- `trust_policy: "company"` — relaxed: validators are known (optionally tied to SSO), sybil
  defense largely unnecessary, lower thresholds, faster promotion. A commons with aligned
  incentives.

### 4.5 Privacy model

Auto-harvest raises leak risk because output is no longer hand-curated. Defense in depth:

1. Regex scrub (existing `redactionErrors`: paths, emails, secret-looking tokens, non-example URLs).
2. **LLM sanitizer** abstracts proprietary specifics (product/customer names, internal logic)
   and flags anything risky.
3. **Local hold**: harvested lessons sit in a local outbox; never auto-sent in the same run.
4. **Bias to drop**: when the sanitizer is uncertain, discard rather than send — a leaked
   detail in a global KB is unrecoverable.
5. Sharing mode (`local-only`/`preview-only`/`share-enabled`) still gates all outbound sends.

### 4.6 Incentive / reciprocity model

No hard torrent-style ratio gate (it incentivizes junk, walls cold-start users, and pressures
private sharing). Instead, reciprocity is near-automatic and quality-aligned:

- **Auto-harvest makes seeding passive** — doing work emits sanitized lessons automatically.
- **Attestation-on-use** — consuming a lesson triggers a cheap, privacy-safe outcome
  attestation (confirm/contradict + context tags). This is the exact ground-truth signal the
  maturation engine needs.
- **Reputation-as-access (graduated)** — good contributions earn reputation; reputation
  unlocks *more* (result counts, advisory tiers, higher rate-limits). Everyone keeps a useful
  free baseline (top `trusted` results), so there is no cold-start wall.
- The **profitability gate** (`shouldQuerySharedKb`) ensures a query only runs when expected
  savings exceed query cost — so consumption is net token-positive by construction.
- Company brains are an open commons; reciprocity gating mainly concerns the global brain.

## 5. Relationship to existing code

**Reuse as-is (built, 18 tests green):** lesson/revocation schema, regex redaction, snapshot
build, Ed25519 manifest sign/verify, search, trust-gated statuses, sharing-mode config.

**Extend:** `shouldQuerySharedKb` profitability scorer → also a "should-contribute" novelty gate.

**From Plan A** (`2026-06-04-shared-kb-submissions-attestations.md`): identity, proposal,
attestation, reputation, batch, Git submit.

**From Plan B** (`2026-06-04-shared-kb-abuse-resistant-intake.md`): intake Worker, R2
quarantine, rate limits, export — retargeted onto the Brain contract + D1.

**New (the "next-level" parts neither plan has):** auto-harvest hook, LLM sanitizer, LLM-judge
review tier, staged-maturation promotion/demotion engine, live D1-backed brain, Brain Provider
contract + conformance suite + self-hostable reference server, attestation-on-use, and
reputation-as-access.

### ADR impact

- **ADR-0007** (signed static packs): its *distribution* idea survives (snapshots remain the
  consumer artifact); its *storage = reviewed Git JSONL* and *human-review-before-publication*
  decisions are **superseded** by live D1 + automated maturation. SP4 ships a superseding ADR.
- **ADR-0008** (explicit opt-in): the privacy default (`local_only`) and explicit modes **stay**.
  The *access-reciprocity* stance evolves into reputation-as-access; SP4 ships an ADR refining it.
- New ADRs (numbers assigned at creation): **ADR-0009 ships the self-hostable Brain server**
  (vendor-neutral contract; Docker+SQLite v1; supersedes ADR-0007's storage/human-review gate
  for live deployments while preserving its signed-snapshot distribution). Still to come: live
  D1 brain adapter, automated staged-maturation trust gate, and reputation-as-access incentive
  model (the future Plan A/B ADRs take the next free numbers).

## 6. Risks and mitigations

1. **Voting ≠ truth**, even outcome-grounded. A lesson can be "works here" yet wrong elsewhere.
   Mitigation: context-clustering + advisory tiers; never claim universal correctness.
2. **LLM sanitizer is probabilistic.** Mitigation: regex + LLM + local hold + bias-to-drop;
   sensitive repos can disable harvest entirely.
3. **Cold start.** Few validators → independence/diversity thresholds never met → nothing
   reaches `trusted`. Mitigation: bootstrap policy (advisory-only until network is large enough);
   company brains use relaxed thresholds.
4. **"No maintenance" asterisk.** A live D1 brain needs operation, backups, and a kill-switch /
   mass-revoke path for detected poisoning. Lighter than a moderated platform, but not zero.
5. **LLM cost.** Sanitizer + judge are per-lesson model calls; the confidence gate must keep
   volume sane, and judge calls can batch.

## 7. Decomposition into sub-projects

Each is independently shippable and turns on more autonomy than the last.

| ID | Scope | Human in loop? | Depends on |
|---|---|---|---|
| **SP0** | Commit the existing green MVP (currently all untracked) | — | — |
| **SP1** | Contribution loop: identity, proposal, attestation, reputation, batch, Git submit (Plan A) | Yes | SP0 |
| **SP2** | Auto-harvest + privacy: harvest hook, novelty gate, LLM sanitizer, local hold | Yes | SP1 |
| **SP3** | Brain contract + abuse-resistant intake: HTTP contract, conformance suite, Cloudflare Worker + D1 + self-hostable reference, rate limits, attestation-on-use (Plan B, retargeted) | Partial | SP1 |
| **SP4** | Self-validation engine: LLM-judge review tier, staged maturation promotion/demotion, live D1 scoring, reputation-as-access, per-brain trust policy, superseding ADRs | **No** | SP2, SP3 |

**Build order:** SP0 → SP1 → SP2 → SP3 → SP4. SP4 is the point at which the system becomes the
autonomous, self-validating hive mind.

## 8. Deferred / open questions (for sub-project specs)

- Exact maturation thresholds (N independent validators, M context clusters, observation window)
  for the global `trust_policy` — to be tuned in SP4 with simulated data.
- LLM model + prompt for sanitizer and judge (cost vs. recall) — SP2/SP4.
- Federation semantics (search merge order, per-brain contribution routing) — post-v1.
- Brain auth scheme details for company deployments (bearer vs. mTLS vs. SSO) — SP3.
- Kill-switch / mass-revoke operator runbook — SP3/SP4.
