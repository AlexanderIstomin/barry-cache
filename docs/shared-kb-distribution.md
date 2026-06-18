# Shared KB Distribution

The shared/community solutions KB reaches consumers two ways, both vendor-neutral:

1. **A live Brain server (primary).** Run a self-hostable Brain that ingests submissions and
   serves search + signed snapshots. See [Brain self-hosting](brain-self-host.md). A Brain can
   be private (company) or the public global instance.
2. **Signed static snapshots (optional mirror).** `kb build` produces a signed snapshot that can
   be hosted on *any* static host or object store. Clients read it with `kb search --source <url>`.

Barry is not tied to any specific cloud vendor for either path.

## Source Layout

```text
shared-kb/
  lessons/*.jsonl
  revocations.jsonl
```

Lessons are anonymized advice records. They are not repo-local Barry facts and must not contain
project names, private file paths, customer names, secrets, stack traces, or full code dumps.

## Local Sharing Modes

Barry does not send shared KB contributions by default. Contribution settings are repo-local and
stored in `.barry-cache/config.json`, which `barry-cache init` adds to `.gitignore`.

```bash
barry-cache kb sharing status
barry-cache kb sharing set local-only
barry-cache kb sharing set preview-only
barry-cache kb sharing set share-enabled
```

Modes:

- `local-only`: shared KB contribution is disabled.
- `preview-only`: Barry may show or draft sanitized contribution payloads locally, but sending
  remains disabled.
- `share-enabled`: Barry may send shared KB contributions when an explicit command is invoked,
  and remote shared KB access is enabled.

Barry gates remote shared KB access on `share-enabled`; local snapshot search still works in every
mode, which keeps offline mirrors, tests, and maintainer workflows available.

## Build A Signed Static Snapshot

```bash
bun run barry -- kb validate --source shared-kb
bun run barry -- kb build --source shared-kb --out dist/shared-kb --private-key private.pem --public-key public.pem
```

The build writes:

```text
dist/shared-kb/
  lessons/lessons.jsonl
  revocations.jsonl
  indexes/search-index.json
  manifest.json
  manifest.sig
```

## Serve / Distribute

**Primary — a Brain.** A running Brain serves the same artifacts over its vendor-neutral HTTP
contract (`GET /v1/snapshot`, `GET /v1/search`) and signs them with its own pinned key. See
[Brain self-hosting](brain-self-host.md).

**Optional — a static mirror.** Because the snapshot is just files, you can mirror `dist/shared-kb`
to any static host or object store — S3, Cloudflare R2, GCS, nginx, GitHub/Cloudflare Pages, etc.
Expose it behind a URL and clients fetch with:

```bash
barry-cache kb search --source https://kb.example.com/latest --query "validation failures"
```

The signed `manifest.sig` provides tamper-evidence regardless of which host serves the files.

## Trust Rules

- `trusted` lessons are included in default search.
- `reviewed` lessons are included only when the client passes `--include-reviewed`.
- `submitted`, `quarantined`, and `rejected` lessons are not published.
- Lessons targeted by `revoked` records are removed from the generated search index.
- Bad accepted lessons must be challenged or revoked through `revocations.jsonl`, then a new
  signed snapshot must be published (or, on a live Brain, the change takes effect on the next
  snapshot rebuild).

## Abuse Handling

Whatever the distribution surface, run validation before publishing:

```bash
bun run barry -- kb validate --source shared-kb
```

Reject records that are not anonymized, lack applicability, lack rationale, or claim universal
correctness. On a Brain, intake performs this validation automatically and binds each submission
to its signing key (see [Brain self-hosting](brain-self-host.md)).
