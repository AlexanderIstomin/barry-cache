---
id: ADR-0014
title: Remove unused hive-mind signing residue and simplify validator identity
status: active
date: 2026-06-19
supersedes: []
tags: [shared-kb, cq, hive-mind, cleanup]
---

# ADR-0014: Remove unused hive-mind signing residue and simplify validator identity

## Context

ADR-0011 retired the standalone global hive-mind (Brain server, signed-snapshot
distribution, attestation/reputation/maturation) in favor of interoperating with
Mozilla cq. It stated that Ed25519 signing would be "retained for local integrity
only" because cq's `propose.json` carries no signature field.

In the shipped code that retention never materialized. The signer that consumed the
key, `shared-kb-attestation.ts`, was deleted during the retirement, and nothing in
`src/` signs or verifies anything. What remained was `shared-kb-identity.ts`
generating an Ed25519 keypair, storing the private key in `identity.json`, and then
using only a SHA-256 of the public key as the `created_by` attribution on cq
proposals — an elaborate way to mint a random id, plus a private key on disk with no
consumer.

A review also surfaced related residue from the retired trust engine: the
`sharedKbStatuses` enum carried five maturation-lifecycle values no code ever set
(`quarantined`, `rejected`, `deprecated`, `revoked`, `superseded`); `evidence.source_type`
allowed two intake-model values never produced (`anonymized_project_pattern`,
`maintainer_review`); `SharedKbLesson.supersedes` was validated but never set or mapped
to cq; and two no-op placeholder CLI commands (`generate-adapters`, `lint-wiki`) lingered.

## Decision

Finish the hive-mind retirement by removing the signing residue rather than keeping it
for a "local integrity" feature that was never built:

- The validator identity is a stable, anonymous per-repo id (`validator-<uuid>`)
  persisted once in `.barry-cache/shared-kb/identity.json` and reused. No keypair, no
  private key on disk, no signing. It exists only as `created_by` attribution on cq
  proposals; cq carries no signatures, so there is nothing to sign.
- Trim the canonical lesson schema to what is actually produced/consumed:
  `sharedKbStatuses` = `submitted | reviewed | trusted | challenged`,
  `evidence.source_type` = `community_report`, and drop `SharedKbLesson.supersedes`.
- Remove the `generate-adapters` and `lint-wiki` placeholder commands; `init`
  regenerates adapters and there are no wiki lint rules.

If signed/attested contributions are ever needed, they return as a deliberate feature
(a new keypair + signer + a server that accepts signatures), not as latent residue.

## Consequences

- No private-key material is written to disk, so the earlier owner-only (`0o600`)
  hardening of `identity.json` is moot and reverted; the file is no longer sensitive.
- Existing `identity.json` files keep working: `loadOrCreateValidatorIdentity` reads
  whatever is present and uses its `validator_id`, so prior contributors keep their id.
- The lesson schema is narrower; reintroducing a status or source type is a one-line
  change behind a deliberate decision.
- Facts referencing this ADR: see `docs/context/features/shared-kb/FACTS.jsonl`
  (`SKB-…c1f0` corrected; new residue-removal facts added).
