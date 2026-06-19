---
id: ADR-0007
title: Store shared solutions KB as signed static packs
status: superseded
date: 2026-06-04
supersedes: []
tags: [shared-kb, storage, cloudflare, agents]
---

# ADR-0007: Store shared solutions KB as signed static packs

## Context

Barry Cache's project-local memory keeps exact, source-backed repo facts in `docs/context/` and operational session history in `.context-state/`. A community-wide solutions KB has a different job: it should share anonymized advice patterns without leaking private project details and without turning community submissions into canonical repo truth.

The shared KB also needs a low-maintenance publishing model. A hosted database or public write API would add accounts, moderation queues, migrations, abuse handling, and ongoing infrastructure work. Git PR review and static distribution better match Barry's existing source-backed model while keeping Cloudflare Pages/R2 available as a cheap distribution layer.

## Decision

Store shared solutions KB records as reviewed JSONL source files in a Git repository, then build signed static packs for publication. Barry provides `kb validate`, `kb build`, and `kb search` commands for validating anonymized lessons, generating a manifest plus search index, optionally signing the manifest with Ed25519 keys, and searching local or hosted snapshots.

The shared KB source records are advisory lessons, not canonical Barry facts. Default search includes only `trusted` lessons; `reviewed` lessons require an explicit flag. Lessons targeted by `revoked` records are excluded from generated search indexes. Cloudflare Pages/R2 can distribute the generated snapshot, but Cloudflare is not the source of truth.

## Consequences

The v1 system keeps setup and maintenance small: community contributions can use normal Git review, static files are easy to mirror, and clients can consume snapshots without an online database dependency.

Static publishing makes immediate writes, live votes, and dynamic gamification out of scope for v1. Those features can be added later with Workers/D1 or another moderation backend after the static trust pipeline is proven.

Because anonymization errors can still happen, validation rejects obvious revealing strings and maintainers must review submissions before publication. Signed manifests provide tamper evidence for published snapshots but do not prove that a lesson is correct; challenge and revocation records remain part of the trust model.
