import { exists, readText, repoPath, writeText } from "./fs";

export const sharedKbContributionModes = ["local-only", "preview-only", "share-enabled"] as const;

export type SharedKbContributionMode = "local_only" | "preview_only" | "share_enabled";
export type SharedKbContributionModeInput = typeof sharedKbContributionModes[number];

export interface SharedKbConfig {
  shared_kb: {
    contribution: SharedKbContributionMode;
  };
}

const defaultSharedKbConfig: SharedKbConfig = {
  shared_kb: {
    contribution: "local_only",
  },
};

export function sharedKbConfigPath(repo: string): string {
  return repoPath(repo, ".barry-cache/config.json");
}

export async function readSharedKbConfig(options: { repo: string }): Promise<SharedKbConfig> {
  const path = sharedKbConfigPath(options.repo);
  if (!(await exists(path))) return cloneConfig(defaultSharedKbConfig);

  const raw = JSON.parse(await readText(path)) as unknown;
  const contribution = readContributionMode(raw);
  return {
    shared_kb: {
      contribution: contribution ?? defaultSharedKbConfig.shared_kb.contribution,
    },
  };
}

export async function writeSharedKbContributionMode(options: { repo: string; mode: SharedKbContributionMode }): Promise<SharedKbConfig> {
  const path = sharedKbConfigPath(options.repo);
  const config: SharedKbConfig = {
    shared_kb: {
      contribution: options.mode,
    },
  };
  await writeText(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
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

function readContributionMode(raw: unknown): SharedKbContributionMode | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const sharedKb = (raw as { shared_kb?: unknown }).shared_kb;
  if (typeof sharedKb !== "object" || sharedKb === null) return undefined;
  const contribution = (sharedKb as { contribution?: unknown }).contribution;
  if (contribution === "local_only" || contribution === "preview_only" || contribution === "share_enabled") return contribution;
  return undefined;
}

function cloneConfig(config: SharedKbConfig): SharedKbConfig {
  return {
    shared_kb: {
      contribution: config.shared_kb.contribution,
    },
  };
}
