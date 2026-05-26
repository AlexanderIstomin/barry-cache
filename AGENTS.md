<!-- barry-cache:start -->
## Barry Cache

Barry Cache remembers this repo through source-backed context files.

Use the repo package script so Barry Cache runs from the local npm dependency without relying on shell PATH. If the dependency is missing, run `bun install` first. Use `npx barry-cache <command>` only when package scripts are unavailable.

Repeated retrieval commands use the disposable parsed index in `.context-cache/context-index.json` when source context files have not changed.

Start task context with:

```bash
bun run barry -- resume --task "<task>"
```

Use focused retrieval during work:

```bash
bun run barry -- route --task "<task>"
bun run barry -- search --query "<query>"
bun run barry -- load --route "<route>"
```

When context files change, run:

```bash
bun run barry -- validate
```

Before handing off substantial work, record factual evidence:

```bash
bun run barry -- finalize --status success --summary "<summary>"
```

Memory policy:

- Finalize writes operational memory only.
- Do not claim Barry canonical memory is updated unless `docs/context/` changed.
- If a task adds durable implementation behavior, add or update source-backed facts in `docs/context/features/*/FACTS.jsonl` and run `bun run barry -- validate`.
- Use ISO 8601 timestamps in fact `updated_at` values when saving new facts, so same-day feature order is preserved in review timelines.

Decision records:

- Create an ADR when a task introduces or changes durable architecture, repo policy, storage layout, agent protocol, or cross-module behavior.
- Use `bun run barry -- adr new --title "<decision>" --tags "<tags>"`.
- Add or update a `kind: "decision"` fact in `docs/context/features/*/FACTS.jsonl` with `src` pointing to the ADR file.
- Do not create ADRs for routine bug fixes, local refactors, temporary notes, or uncertain ideas.
<!-- barry-cache:end -->
