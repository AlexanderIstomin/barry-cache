import { exists, readText, repoPath, writeText } from "./fs";

export const sharedKbContributionModes = ["local-only", "preview-only", "share-enabled"] as const;

export type SharedKbContributionMode = "local_only" | "preview_only" | "share_enabled";
export type SharedKbContributionModeInput = typeof sharedKbContributionModes[number];

export interface SharedKbCqConfig {
  url: string;
  api_key_ref?: string;
  domains?: string[];
}

export interface SharedKbConfig {
  shared_kb: {
    contribution: SharedKbContributionMode;
    cq?: SharedKbCqConfig;
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
  const cq = readCqConfig(raw);
  return {
    shared_kb: {
      contribution,
      ...(cq ? { cq } : {}),
    },
  };
}

export async function writeSharedKbContributionMode(options: { repo: string; mode: SharedKbContributionMode }): Promise<SharedKbConfig> {
  const current = await readSharedKbConfig({ repo: options.repo });
  const next: SharedKbConfig = {
    shared_kb: {
      contribution: options.mode,
      ...(current.shared_kb.cq ? { cq: current.shared_kb.cq } : {}),
    },
  };
  await persist(options.repo, next);
  return next;
}

export async function writeSharedKbCqConfig(options: { repo: string; cq: SharedKbCqConfig }): Promise<SharedKbConfig> {
  if (!/^https?:\/\//.test(options.cq.url)) {
    throw new Error("cq.url must start with http:// or https://");
  }
  const current = await readSharedKbConfig({ repo: options.repo });
  const next: SharedKbConfig = { shared_kb: { contribution: current.shared_kb.contribution, cq: options.cq } };
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

function readCqConfig(raw: unknown): SharedKbCqConfig | undefined {
  const cq = sharedKbSection(raw)?.cq;
  if (typeof cq !== "object" || cq === null) return undefined;
  const candidate = cq as { url?: unknown; api_key_ref?: unknown; domains?: unknown };
  if (typeof candidate.url !== "string" || candidate.url.length === 0) return undefined;
  const config: SharedKbCqConfig = { url: candidate.url };
  if (typeof candidate.api_key_ref === "string") config.api_key_ref = candidate.api_key_ref;
  if (Array.isArray(candidate.domains) && candidate.domains.every((d) => typeof d === "string")) {
    config.domains = candidate.domains as string[];
  }
  return config;
}

function sharedKbSection(raw: unknown): { contribution?: unknown; cq?: unknown } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const sharedKb = (raw as { shared_kb?: unknown }).shared_kb;
  if (typeof sharedKb !== "object" || sharedKb === null) return undefined;
  return sharedKb as { contribution?: unknown; cq?: unknown };
}
