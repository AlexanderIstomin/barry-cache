---
id: ADR-0010
title: Self-validate shared KB via attestation, reputation, and staged maturation
status: superseded
date: 2026-06-18
supersedes: []
tags: [shared-kb, brain, attestation, reputation, maturation]
---

# ADR-0010: Self-validate shared KB via attestation, reputation, and staged maturation

## Context

ADR-0009 shipped a Brain whose `company` policy trusts submissions immediately, deferring the
strict `global` trust gate. The hive-mind vision
(`docs/superpowers/specs/2026-06-18-self-validating-agent-hive-mind-design.md`) requires the
global KB to decide what is `trusted` with no human moderator. Consensus alone proves agreement,
not correctness, and a public KB invites poisoning. We need an automated gate that is grounded in
real outcomes, resists fabricated identities, and self-corrects when a lesson turns out wrong.

## Decision

Validation is **outcome-grounded attestation** aggregated by **reputation** and gated by **staged
maturation**, all running on the Brain under `trust_policy: global`. `company` keeps immediate
trust unchanged.

- **Attestations** are signed records (`confirmed`/`contradicted`/`not_applicable` ×
  `observed_success`/`observed_failure`/`static_review` + confidence + context tags). They are
  bound to their signing key the same way intake batches are: the Brain derives `validator_id`
  from the verified public key and rejects mismatches, so reputation cannot be stolen or
  fabricated. Agents emit them on use (`kb attest`).
- **Reputation** (`shared-kb-reputation.ts`) is a single-pass, pure computation: lesson scores
  are a sigmoid of signed, evidence-weighted (`observed_failure` 1.2 > `observed_success` 1.0 >
  `static_review` 0.35), copied-evidence-discounted (×0.25 when an attestation lists the lesson in
  `upstream_seen`) sum; validator reputation is agreement with the resulting scores. No recursive
  EigenTrust iteration in v1.
- **Maturation** (`brain/core/maturation.ts`) promotes `reviewed → trusted` only with enough
  independent confirmations across diverse contexts, a positive score, and a minimum observation
  window; a credible `observed_failure` that drives the score net-negative demotes to
  `challenged`. Terminal statuses are never auto-changed. Thresholds are tunable defaults.

The Brain re-scores and re-matures lessons after each accepted attestation/intake. There is no
LLM judge in the Brain: the `reviewed` quality gate is the deterministic intake validation
(schema + redaction), and abstraction/sanitization stays agent-in-the-loop (ADR-aligned with the
auto-harvest decision).

## Consequences

The global KB becomes self-validating and self-correcting without a human moderator, while
fabricated identities cannot accrue or steal reputation. Trust is earned from real, diverse,
outcome-grounded usage rather than vote count, and copied evidence is discounted. Limitations:
attestation is still agreement (outcome-grounded, not proof); thresholds need tuning with real
data; reputation recompute is a full pass per attestation (fine at SQLite scale, optimize later);
and a perspective-diverse or LLM-judge review tier remains future work. Facts describing
attestation signing/binding, reputation scoring, staged maturation, and `kb attest` should
reference this ADR.
