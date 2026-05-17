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

export const agentInstructions = `
## Barry Cache

Barry Cache remembers this repo through source-backed context files.

Start task context with:

\`\`\`bash
barry-cache resume --task "<task>"
\`\`\`

Use focused retrieval during work:

\`\`\`bash
barry-cache route --task "<task>"
barry-cache search --query "<query>"
barry-cache load --route "<route>"
\`\`\`

When context files change, run:

\`\`\`bash
barry-cache validate
\`\`\`

Before handing off substantial work, record factual evidence:

\`\`\`bash
barry-cache finalize --status success --summary "<summary>"
\`\`\`
`;

export const indexMd = `# Context Index

This directory stores source-backed context for coding agents and humans.

Use:

\`\`\`bash
barry-cache resume --task "<task>"
barry-cache validate
\`\`\`

## Routes

Feature context packs live in \`docs/context/features/*\`.
`;

export const logMd = `# Context Log

Barry Cache records reviewed context changes here.
`;

export const maintenanceMd = `# Context Maintenance

- Keep project truth in Git.
- Add source-backed facts to feature \`FACTS.jsonl\` files.
- Use ADRs for decisions that change architecture.
- Treat \`.context-state/\` as operational memory, not canonical truth.
- Run \`barry-cache validate\` after context changes.
`;

export const readmeMd = `# Barry Cache Context

Barry Cache keeps repo context source-backed, validated, and easy for agents to load.
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
