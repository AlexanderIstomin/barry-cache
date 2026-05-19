export const managedStart = "<!-- barry-cache:start -->";
export const managedEnd = "<!-- barry-cache:end -->";

export function managedBlock(body: string): string {
  return `${managedStart}\n${body.trim()}\n${managedEnd}\n`;
}

export function applyManagedBlock(existing: string, body: string): string {
  const nextBlock = managedBlock(body);
  const start = existing.indexOf(managedStart);
  const end = existing.indexOf(managedEnd);
  if (start >= 0 && end >= start) {
    const afterEnd = end + managedEnd.length;
    return `${existing.slice(0, start)}${nextBlock}${existing.slice(afterEnd).replace(/^\n/, "")}`;
  }
  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : "";
  return `${prefix}${nextBlock}`;
}

export function agentInstructions(commandPrefix = "barry-cache", installCommand?: string): string {
  const commandNote = installCommand
    ? `Use the repo package script so Barry Cache runs from the local npm dependency without relying on shell PATH. If the dependency is missing, run \`${installCommand}\` first. Use \`npx barry-cache <command>\` only when package scripts are unavailable.`
    : "Use `barry-cache` directly. If it is unavailable, run it through your package runner, for example `npx barry-cache <command>`.";
  return `
## Barry Cache

Barry Cache remembers this repo through source-backed context files.

${commandNote}

Start task context with:

\`\`\`bash
${commandPrefix} resume --task "<task>"
\`\`\`

Use focused retrieval during work:

\`\`\`bash
${commandPrefix} route --task "<task>"
${commandPrefix} search --query "<query>"
${commandPrefix} load --route "<route>"
\`\`\`

When context files change, run:

\`\`\`bash
${commandPrefix} validate
\`\`\`

Before handing off substantial work, record factual evidence:

\`\`\`bash
${commandPrefix} finalize --status success --summary "<summary>"
\`\`\`
`;
}

export const indexMd = `# Context Index

This directory stores source-backed context for coding agents and humans.

Use:

\`\`\`bash
barry-cache resume --task "<task>"
barry-cache validate
\`\`\`

## Routes

Feature context packs live in \`docs/context/features/*\`.

## Decisions

Architecture decision records live in \`docs/context/adrs/*\`.
`;

export const logMd = `# Context Log

Barry Cache records reviewed context changes here.
`;

export const maintenanceMd = `# Context Maintenance

- Keep project truth in Git.
- Add source-backed facts to feature \`FACTS.jsonl\` files.
- Use \`barry-cache adr new --title "<decision>"\` for decisions that change architecture.
- Reference ADR files from decision facts through the fact \`src\` array.
- Treat \`.context-state/\` as operational memory, not canonical truth.
- Run \`barry-cache validate\` after context changes.

## Save an agent session

When a Codex, Claude, Cursor, Copilot, Gemini, or other agent session contains useful project memory, ask the agent to save it into Barry Cache using this policy:

\`\`\`text
Save this session to Barry Cache.

Rules:
1. Record the session outcome with barry-cache finalize.
2. Promote only source-backed implementation facts into docs/context/features/*/FACTS.jsonl.
3. Put uncertain notes, blockers, and next steps in operational memory, not canonical facts.
4. Update IDMAP.md or KG.adj only when new source IDs or relationships are needed.
5. Run barry-cache validate before finishing.
\`\`\`

Recommended command for the session outcome:

\`\`\`bash
barry-cache finalize --status success --summary "<what changed or what was learned>"
\`\`\`
`;

export const readmeMd = `# Barry Cache Context

Barry Cache keeps repo context source-backed, validated, and easy for agents to load.

## Reasoning

This directory is the canonical project memory for Barry Cache. It keeps durable implementation context in Git so humans and agents can review the same source-backed facts instead of relying on private assistant memory or stale chat history.

Barry separates three concerns: \`docs/context/\` is reviewed truth, \`.context-state/\` is operational session continuity, and \`.context-cache/\` is disposable retrieval data. Use this structure to explain existing behavior, route tasks, validate facts, and resume agent work without loading the whole repo.
`;

export const adrReadmeMd = `# Architecture Decision Records

ADRs explain why durable architectural decisions exist. Keep them short, source-backed, and linked from feature facts when a decision affects implementation behavior.

Use:

\`\`\`bash
barry-cache adr new --title "<decision>"
barry-cache adr list
\`\`\`

Facts can reference ADRs with \`src: ["docs/context/adrs/ADR-0001-example.md"]\`. Barry can then route, search, load, and review the decision together with the facts it supports.
`;

export const conceptOverviewMd = `# Project Context Model

Barry Cache separates canonical context, operational state, and generated caches.

- Canonical context lives in \`docs/context/\`.
- Operational continuity lives in \`.context-state/\`.
- Generated retrieval data lives in \`.context-cache/\`.
`;

export const factSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache fact",
  "type": "object",
  "required": ["id", "subject", "predicate", "object", "src", "status", "kind", "updated_at"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "subject": { "type": "string", "minLength": 1 },
    "predicate": { "type": "string", "minLength": 1 },
    "object": { "type": "string", "minLength": 1 },
    "src": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "status": { "enum": ["active", "superseded", "deprecated", "missing", "conflict"] },
    "kind": { "enum": ["implemented", "decision", "constraint", "test", "risk", "open-question"] },
    "updated_at": { "type": "string" },
    "confidence": { "enum": ["low", "medium", "high"] },
    "tags": { "type": "array", "items": { "type": "string" } }
  }
};

export const adrSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache ADR frontmatter",
  "type": "object",
  "required": ["id", "title", "status", "date"],
  "properties": {
    "id": { "type": "string", "pattern": "^ADR-[0-9]{4}$" },
    "title": { "type": "string", "minLength": 1 },
    "status": { "enum": ["active", "superseded", "deprecated"] },
    "date": { "type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    "supersedes": { "type": "array", "items": { "type": "string" } },
    "tags": { "type": "array", "items": { "type": "string" } }
  }
};

export const routeSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache route",
  "type": "object"
};

export const workStateSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache work state",
  "type": "object"
};

export const strategySchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache strategy",
  "type": "object"
};

export const failureSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Barry Cache failure",
  "type": "object"
};
