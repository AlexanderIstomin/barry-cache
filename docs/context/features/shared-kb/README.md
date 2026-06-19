# Shared KB

Owns Barry's shared/community solutions KB behavior: anonymized lesson schemas and redaction-aware validation, opt-in contribution modes (local-only / preview-only / share-enabled), agent-in-the-loop harvesting of reusable lessons from finalize handoffs, validation failures, and the existing context backlog, and **interoperation with Mozilla's cq** open commons through a versioned adapter.

Barry's lesson format is canonical and reached cq only through `src/core/cq-adapter.ts` (pinned to a cq schema version), so core never couples to cq. Barry **consumes** cq via `GET /api/v1/knowledge` (`kb search --source cq`) and **contributes** provenance-annotated lessons via `POST /api/v1/knowledge` (`kb contribute`), mapping Barry lessons to cq's authoritative `knowledge_unit` schema. cq's `propose` carries no signature or evidence and `confirm`/`flag` are MCP-only, so Barry sends plain provenance-annotated lessons (no signatures or attestations); the validator identity is a stable random per-repo id used only as the cq `created_by` attribution — the Ed25519 signing/keypair residue was removed (see [ADR-0014](../../adrs/ADR-0014-remove-unused-hive-mind-signing-residue-and-simplify-validator-identity.md)).

Use this pack for changes to `barry-cache kb` (sharing, propose, harvest, contribute, search), shared KB lesson validation/redaction, the cq adapter and mapping, the local outbox, or contribution settings.

The standalone global hive-mind (the self-hostable Brain server, signed static-pack distribution, and the attestation/reputation/maturation engine) was retired in favor of cq interop — see [ADR-0011](../../adrs/ADR-0011-interoperate-with-cq-and-retire-the-standalone-global-hive-mind.md).
