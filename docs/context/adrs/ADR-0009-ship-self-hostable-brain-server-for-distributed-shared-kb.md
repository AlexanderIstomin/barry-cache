---
id: ADR-0009
title: Ship self-hostable Brain server for distributed shared KB
status: superseded
date: 2026-06-18
supersedes: []
tags: [shared-kb, brain, self-host, vendor-independence]
---

# ADR-0009: Ship self-hostable Brain server for distributed shared KB

## Context

ADR-0007 stored the shared KB as reviewed Git JSONL published as signed static packs, with
maintainer Git review as the trust gate. The distributed hive-mind direction
(`docs/superpowers/specs/2026-06-18-self-validating-agent-hive-mind-design.md`) needs a live
server that ingests submissions, serves search, and produces snapshots. Two requirements shape
the server: it must support a private, company-level KB (a team points its Barry instances at
their own KB and never contacts the public one), and it must not lock adopters into a single
cloud vendor.

A server hardcoded to one cloud product would defeat both. The shared KB also already owns
schema, validation, redaction, Ed25519 signing, and search scoring in `src/core/shared-kb.ts`,
which the server must reuse rather than duplicate.

## Decision

Ship a self-hostable "Brain" server built on a portable core: the HTTP layer is a pure Web Fetch
API handler (`(Request) => Promise<Response>`), persistence is behind a `BrainStore` interface,
and snapshot output is behind a publisher boundary. v1 ships one deployment — a single Docker
container backed by `bun:sqlite` (no external services, no new runtime dependencies) — runnable
with one command. The same core can later gain Cloudflare Workers + D1 or Postgres adapters
without a rewrite.

The server reuses `src/core/shared-kb.ts` (schema, validation, redaction, signing, search
scoring), refactored so snapshot artifacts can be built from in-memory records. It exposes a
vendor-neutral contract (`/healthz`, `/v1/intake`, `/v1/search`, `/v1/snapshot`, `/v1/attest`,
`/v1/lesson/:id`) plus a conformance suite any deployment can run to prove compatibility. Each
brain generates its own Ed25519 signing keypair; clients pin its public-key fingerprint and
verify snapshot signatures end-to-end, so trust is anchored in the brain itself with no central
authority.

Trust behavior is per-brain policy. `company` (v1 default) makes submitted lessons usable
(`trusted`) immediately, fitting an internal team of known validators. `global` stores
submissions as `reviewed` and keeps them out of default search; the strict staged-maturation and
reputation engine that auto-promotes `reviewed → trusted` is deferred to a later component.

## Consequences

One codebase serves both the public global KB and private company KBs; deployment differs only
by adapter and trust policy. The operational surface for v1 is just a container plus a SQLite
file and an identity file to back up. Outbound abuse controls (rate limits, proof-of-work) and
the automated maturation/reputation engine are intentionally out of scope for this baseline and
will arrive with the global deployment and SP4 respectively. This decision supersedes ADR-0007's
storage-and-human-review trust gate for live deployments while preserving its signed-static-pack
distribution; ADR-0007 is left active for the static publishing flow until the live path fully
replaces it. Facts describing the Brain server, its portable core, the Docker+SQLite v1 target,
fingerprint pinning, and the company/global trust split should reference this ADR.
