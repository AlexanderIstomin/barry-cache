# Shared KB

Owns Barry's shared/community solutions KB behavior: anonymized lesson schemas and redaction-aware validation, opt-in contribution modes (local-only / preview-only / share-enabled), agent-in-the-loop harvesting of reusable lessons from finalize handoffs, validation failures, and the existing context backlog, and **interoperation with Mozilla's cq** open commons through a versioned adapter.

Barry's lesson format is canonical and reached cq only through `src/core/cq-adapter.ts` (pinned to a cq schema version), so core never couples to cq. Barry **consumes** cq via `GET /api/v1/knowledge` (`kb search --source cq`) and **contributes** provenance-annotated lessons via `POST /api/v1/knowledge` (`kb contribute`), mapping Barry lessons to cq's authoritative `knowledge_unit` schema. cq's `propose` carries no signature or evidence and `confirm`/`flag` are MCP-only, so Ed25519 signing is retained for local outbox integrity only and attestations are not sent to cq.

Use this pack for changes to `barry-cache kb` (sharing, propose, harvest, contribute, search), shared KB lesson validation/redaction, the cq adapter and mapping, the local outbox, or contribution settings.

The standalone global hive-mind (the self-hostable Brain server, signed static-pack distribution, and the attestation/reputation/maturation engine) was retired in favor of cq interop — see [ADR-0011](../../adrs/ADR-0011-interoperate-with-cq-and-retire-the-standalone-global-hive-mind.md).
