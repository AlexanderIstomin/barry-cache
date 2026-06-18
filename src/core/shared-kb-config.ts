import { exists, readText, repoPath, writeText } from "./fs";

export const sharedKbContributionModes = ["local-only", "preview-only", "share-enabled"] as const;

export type SharedKbContributionMode = "local_only" | "preview_only" | "share_enabled";
export type SharedKbContributionModeInput = typeof sharedKbContributionModes[number];

export type SharedKbBrainScope = "private" | "global";
export type SharedKbBrainTrustPolicy = "company" | "global";

export interface SharedKbBrainConfig {
  url: string;
  scope: SharedKbBrainScope;
  trust_policy?: SharedKbBrainTrustPolicy;
}

export interface SharedKbConfig {
  shared_kb: {
    contribution: SharedKbContributionMode;
    brain?: SharedKbBrainConfig;
  };
}

const defaultContribution: SharedKbContributionMode = "local_only";

export function sharedKbConfigPath(repo: string): string {
  return repoPath(repo, ".barry-cache/config.json");
}

export async function readSharedKbConfig(options: { repo: string }): Promise<SharedKbConfig> {
  const path = sharedKbConfigPath(options.repo);
  if (!(await exists(path))) return { shared_kb: { contribution: defaultContribution } };

  const raw = JSON.parse(await readText(path)) as unknown;
  const contribution = readContributionMode(raw) ?? defaultContribution;
  const brain = readBrainConfig(raw);
  return { shared_kb: brain ? { contribution, brain } : { contribution } };
}

export async function writeSharedKbContributionMode(options: { repo: string; mode: SharedKbContributionMode }): Promise<SharedKbConfig> {
  const current = await readSharedKbConfig({ repo: options.repo });
  const next: SharedKbConfig = { shared_kb: { contribution: options.mode, ...(current.shared_kb.brain ? { brain: current.shared_kb.brain } : {}) } };
  await persist(options.repo, next);
  return next;
}

export async function writeSharedKbBrainConfig(options: { repo: string; brain: SharedKbBrainConfig }): Promise<SharedKbConfig> {
  if (!/^https?:\/\//.test(options.brain.url)) {
    throw new Error("brain.url must start with http:// or https://");
  }
  const current = await readSharedKbConfig({ repo: options.repo });
  const next: SharedKbConfig = { shared_kb: { contribution: current.shared_kb.contribution, brain: options.brain } };
  await persist(options.repo, next);
  return next;
}

export function toSharedKbContributionMode(input: string): SharedKbContributionMode | undefined {
  if (input === "local-only") return "local_only";
  if (input === "preview-only") return "preview_only";
  if (input === "share-enabled") return "share_enabled";
  return undefined;
}

export function formatSharedKbContributionMode(mode: SharedKbContributionMode): SharedKbContributionModeInput {
  return mode.replaceAll("_", "-") as SharedKbContributionModeInput;
}

async function persist(repo: string, config: SharedKbConfig): Promise<void> {
  await writeText(sharedKbConfigPath(repo), `${JSON.stringify(config, null, 2)}\n`);
}

function readContributionMode(raw: unknown): SharedKbContributionMode | undefined {
  const contribution = sharedKbSection(raw)?.contribution;
  if (contribution === "local_only" || contribution === "preview_only" || contribution === "share_enabled") return contribution;
  return undefined;
}

function readBrainConfig(raw: unknown): SharedKbBrainConfig | undefined {
  const brain = sharedKbSection(raw)?.brain;
  if (typeof brain !== "object" || brain === null) return undefined;
  const candidate = brain as { url?: unknown; scope?: unknown; trust_policy?: unknown };
  if (typeof candidate.url !== "string") return undefined;
  if (candidate.scope !== "private" && candidate.scope !== "global") return undefined;
  const trustPolicy = candidate.trust_policy === "company" || candidate.trust_policy === "global" ? candidate.trust_policy : undefined;
  return { url: candidate.url, scope: candidate.scope, ...(trustPolicy ? { trust_policy: trustPolicy } : {}) };
}

function sharedKbSection(raw: unknown): { contribution?: unknown; brain?: unknown } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const sharedKb = (raw as { shared_kb?: unknown }).shared_kb;
  if (typeof sharedKb !== "object" || sharedKb === null) return undefined;
  return sharedKb as { contribution?: unknown; brain?: unknown };
}
