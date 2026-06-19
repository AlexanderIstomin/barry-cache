---
id: ADR-0008
title: Require explicit opt-in for shared KB contribution
status: active
date: 2026-06-04
supersedes: []
tags: [shared-kb, privacy, config, agents]
---

# ADR-0008: Require explicit opt-in for shared KB contribution

## Context

Barry shared KB is designed to publish anonymized community lessons, but any feature that can send user or project-derived information outside the repo is sensitive. Many Barry users will treat outbound sharing as a strict no-go unless it is clearly disabled by default and controlled through an auditable local setting.

The project-local Barry context and operational memory can contain private facts, paths, product names, and failure details. Shared KB contribution must be a separate flow that only exposes sanitized payloads after explicit user intent.

## Decision

Barry shared KB contribution defaults to `local_only`. The setting lives in `.barry-cache/config.json`, a repo-local user config directory that `barry-cache init` ignores through the managed `.gitignore` block.

The CLI exposes explicit sharing modes:

- `local-only`: shared KB contribution is disabled.
- `preview-only`: Barry may prepare or display sanitized contribution payloads locally, but sending remains disabled.
- `share-enabled`: Barry may send shared KB contributions only when an explicit send command is invoked, and may crawl remote shared KB sources.

The modes use plain names instead of joke or movie-reference names so privacy behavior is clear in scripts, audits, documentation, and support conversations.

Barry gates outbound remote shared KB search on `share-enabled`. Local shared KB snapshots can still be searched in any mode so maintainers, tests, and mirrored/offline workflows are not blocked.

## Consequences

Barry can later add proposal and send commands without changing the privacy baseline. Contribution features must check this config before displaying or sending payloads.

Users who want sharing must opt in per repository. This adds one small local config file, but avoids putting privacy-sensitive choices in committed project context or agent instructions.

Community KB access has a reciprocity signal: users who want to crawl the public shared KB must set the repository to the same mode that allows explicit contributions. The setting alone does not send data; actual submission still requires a future explicit send command.
