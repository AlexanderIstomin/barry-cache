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

`load` and `resume` return a relevance-ranked budgeted slice by default (~2000 tokens per pack), not the whole pack. Trust the slice — the result lists any `dropped` fact ids and an `expand_hint`. If a needed fact is missing, restore just that id with `--expand <id>`; use `--expand all` only when you genuinely need the full pack, or `--budget <N>` to resize.

Workspace context is optional. When `docs/context/workspaces.json` exists and you know relevant files or directories, include them so Barry can choose the right workspace:

```bash
bun run barry -- resume --task "<task>" --paths "path-a,path-b"
bun run barry -- workspace infer --task "<task>" --paths "path-a,path-b"
```

Use the workspace Barry selects. If Barry reports `workspace_decision.status: "ambiguous"`, do not guess — ask the user or rerun with `--workspace <slug>`.

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

- Private vs. canonical memory: your agent's own private memory — the local store only you can read (for Claude Code, `MEMORY.md` and its files; other agents have their own) — is invisible to every other agent. Use it only for cross-session *personal* context — user preferences, how to work with this user, and external references.
- Any decision, fact, or constraint another agent would need goes to Barry, never a private memory: an ADR, a `docs/context/features/*/FACTS.jsonl` fact, or a `finalize`/`failure` record. If you are about to write a `project`-type private memory, that is the signal to route it to Barry instead.
- `feedback`-type guidance splits on who it serves: keep it private only when it is about working with *this user* personally (explanation depth, tone, review style). Guidance that states a rule every agent on this repo should follow (e.g. "always run `bun run barry -- validate` before `finalize`") is a policy, not a preference — route it to Barry as an ADR/`AGENTS.md` policy or a `decision` fact.
- Finalize writes operational memory only.
- Failure records write operational validation memory only and should challenge stale handoffs or facts instead of rewriting history.
- Do not claim Barry canonical memory is updated unless `docs/context/` changed.
- If a task adds durable implementation behavior, add or update source-backed facts in `docs/context/features/*/FACTS.jsonl` and run `bun run barry -- validate`.
- Direct `FACTS.jsonl` edits remain supported; use `bun run barry -- fact draft --route "<route>" --prefix "<PREFIX>" ...` when a schema-checked JSONL draft or explicit `--write` append is safer.
- `fact draft` is an authoring guardrail, not broad canonical CRUD; review the resulting diff and run `bun run barry -- validate`.
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
