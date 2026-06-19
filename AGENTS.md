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
bun run barry -- finalize --status success --summary "<summary>" --files "path-a,path-b"
```

When user validation shows previous work is broken, record the contradiction before or while fixing it:

```bash
bun run barry -- failure record --summary "<what failed>" --expected "<expected behavior>" --actual "<observed behavior>" --challenges "<handoff-or-fact-id>"
```

Memory policy:

- Finalize writes operational memory only.
- Failure records write operational validation memory only and should challenge stale handoffs or facts instead of rewriting history.
- Do not claim Barry canonical memory is updated unless `docs/context/` changed.
- If a task adds durable implementation behavior, add or update source-backed facts in `docs/context/features/*/FACTS.jsonl` and run `bun run barry -- validate`.
- There is no `fact` CLI command; update canonical facts by editing `docs/context/features/*/FACTS.jsonl` directly, then run `bun run barry -- validate`.
- Use ISO 8601 timestamps in fact `updated_at` values when saving new facts, so same-day feature order is preserved in review timelines.
- Use collision-resistant fact IDs like `REV-20260526T160512Z-a8f3`; dense review UI may display them as `REV-a8f3`.

Shared KB (cq) — opt-in; act on this only when `bun run barry -- kb sharing status` is not local-only (the user connects with `bun run barry -- kb cq login`):

- Before non-trivial work, check the shared commons: `bun run barry -- kb search --source cq --query "<problem>"`.
- After a confirmed fix, give back: `bun run barry -- kb harvest` drafts a sanitized lesson; review it, then `bun run barry -- kb propose lesson ...` and `bun run barry -- kb contribute`.
- Do not enable sharing or contribute on your own — that is the user's explicit choice. If sharing is local-only, skip cq entirely.

Decision records:

- Create an ADR when a task introduces or changes durable architecture, repo policy, storage layout, agent protocol, or cross-module behavior.
- Use `bun run barry -- adr new --title "<decision>" --tags "<tags>"`.
- Add or update a `kind: "decision"` fact in `docs/context/features/*/FACTS.jsonl` with `src` pointing to the ADR file.
- Do not create ADRs for routine bug fixes, local refactors, temporary notes, or uncertain ideas.
<!-- barry-cache:end -->
