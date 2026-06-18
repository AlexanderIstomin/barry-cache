# Shared KB Cloudflare Distribution

Barry shared KB v1 uses Git as the contribution and review path, then publishes signed static snapshots for cheap distribution.

## Source Layout

```text
shared-kb/
  lessons/*.jsonl
  revocations.jsonl
```

Lessons are anonymized advice records. They are not repo-local Barry facts and they must not contain project names, private file paths, customer names, secrets, stack traces, or full code dumps.

## Local Sharing Modes

Barry does not send shared KB contributions by default. Contribution settings are repo-local and stored in `.barry-cache/config.json`, which `barry-cache init` adds to `.gitignore`.

```bash
barry-cache kb sharing status
barry-cache kb sharing set local-only
barry-cache kb sharing set preview-only
barry-cache kb sharing set share-enabled
```

Modes:

- `local-only`: shared KB contribution is disabled.
- `preview-only`: Barry may show sanitized contribution payloads locally, but sending remains disabled.
- `share-enabled`: Barry may send shared KB contributions only when an explicit send command is invoked, and remote shared KB search is enabled.

Barry gates remote shared KB search on `share-enabled`:

```bash
barry-cache kb search --source https://kb.example.com/latest --query "validation failures"
```

Local snapshot search still works in every mode, which keeps offline mirrors, tests, and maintainer workflows available without requiring outbound sharing.

## Build Snapshot

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

## Publish To Cloudflare R2

Use Wrangler from the shared KB repository:

```bash
npx wrangler r2 bucket create barry-solutions-kb
npx wrangler r2 object put barry-solutions-kb/latest/manifest.json --file dist/shared-kb/manifest.json
npx wrangler r2 object put barry-solutions-kb/latest/manifest.sig --file dist/shared-kb/manifest.sig
npx wrangler r2 object put barry-solutions-kb/latest/indexes/search-index.json --file dist/shared-kb/indexes/search-index.json
npx wrangler r2 object put barry-solutions-kb/latest/lessons/lessons.jsonl --file dist/shared-kb/lessons/lessons.jsonl
npx wrangler r2 object put barry-solutions-kb/latest/revocations.jsonl --file dist/shared-kb/revocations.jsonl
```

Expose the R2 objects through a Cloudflare Worker route or a public bucket domain. Barry clients can then search with:

```bash
barry-cache kb search --source https://kb.example.com/latest --query "validation failures"
```

## Publish Static Pages

Cloudflare Pages can host documentation and a generated search UI later. The first version only needs the static snapshot files above.

## Trust Rules

- `trusted` lessons are included in default search.
- `reviewed` lessons are included only when the client passes `--include-reviewed`.
- `submitted`, `quarantined`, and `rejected` lessons are not published.
- Lessons targeted by `revoked` records are removed from the generated search index.
- Bad accepted lessons must be challenged or revoked through `revocations.jsonl`, then a new signed snapshot must be published.

## Abuse Handling

Keep community submissions in Git PRs. Automated checks should run:

```bash
bun run barry -- kb validate --source shared-kb
```

Maintainers should reject records that are not anonymized, lack applicability, lack rationale, or claim universal correctness.
