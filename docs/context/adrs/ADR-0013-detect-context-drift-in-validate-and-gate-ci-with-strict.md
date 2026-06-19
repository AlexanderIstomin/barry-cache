---
id: ADR-0013
title: Detect context drift in validate and gate CI with --strict
status: active
date: 2026-06-19
supersedes: []
tags: [validate, drift, provenance, ci]
---

# ADR-0013: Detect context drift in validate and gate CI with --strict

## Context

`validate` confirmed that facts were structurally well-formed, but not that they still matched the
code. Canonical context rots silently: a fact's `src` points at a file that was moved or deleted,
or an `open-question`/`risk` lingers for months unaddressed. This is the "unmaintained wiki
misleads" failure — the memory looks authoritative while drifting from reality, and nothing flags it.

## Decision

`validate` gains **drift detection**, reported as **warnings** (it still only *fails* on structural
errors by default, preserving existing behavior):

- **Provenance rot:** each fact `src` is resolved — IDMAP tokens via the feature's `IDMAP.md`, and
  path-like sources directly — and a missing target file raises a warning. ADR-looking sources keep
  their existing "missing ADR source" check.
- **Staleness:** an `open-question` or `risk` fact whose `updated_at` is older than a threshold
  (`staleAfterDays`, default 180) raises a warning so a human revisits it.

A new **`validate --strict`** (also on `doctor`) makes any warning a non-zero exit, so CI can gate
on drift. `validateProject` takes an injectable `now` and `staleAfterDays` for deterministic tests.
Warnings are printed in the human report, with a hint to use `--strict` in CI.

## Consequences

Drift becomes visible at `validate`/CI time instead of being discovered months later, closing the
gap that made source-backed memory degrade quietly. The default stays non-breaking (warnings don't
fail), so existing users see information, not new failures; teams opt into enforcement with
`--strict`. Limitations: provenance resolution only follows IDMAP tokens and path-like sources (not
arbitrary tokens), and staleness is age-based, not git-mtime-based — comparing a fact's age against
the last change of its source files is possible future work. Facts describing drift detection and
`--strict` should reference this ADR.
