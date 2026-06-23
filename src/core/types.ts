export type JsonObject = Record<string, unknown>;

export interface CommandIssue {
  file: string;
  line?: number;
  message: string;
}

export interface FactRecord {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  src: string[];
  status: "active" | "superseded" | "deprecated" | "missing" | "conflict";
  kind: "implemented" | "decision" | "constraint" | "test" | "risk" | "open-question";
  updated_at: string;
  confidence?: "low" | "medium" | "high";
  owner?: string;
  valid_from?: string;
  valid_until?: string;
  supersedes?: string | string[];
  tags?: string[];
}

export interface FeaturePack {
  slug: string;
  dir: string;
  readme: string;
  idmap: string;
  graph: string;
  facts: FactRecord[];
}

// A feature pack without its facts array — used as the `feature` field of load
// output so facts are carried once (top-level), not duplicated under `feature`.
export type LoadedFeature = Omit<FeaturePack, "facts">;

export interface RouteMatch {
  slug: string;
  score: number;
  reason: string;
}

export interface InitResult {
  changed: boolean;
  written: string[];
  updated: string[];
  skipped: string[];
  dryRun: boolean;
  packageManager?: PackageManagerHint;
}

export interface PackageManagerHint {
  name: "bun" | "npm" | "pnpm" | "yarn";
  installCommand: string;
}

export type AgentInstructionTarget = "codex" | "cursor" | "copilot" | "claude" | "gemini" | "llms";

export interface ValidationResult {
  ok: boolean;
  errors: CommandIssue[];
  warnings: CommandIssue[];
}
