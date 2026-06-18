import { join } from "node:path";
import { exists, readText, writeText } from "../../src/core/fs";
import type { TrustPolicy } from "./brain";

export interface BrainConfig {
  version: 1;
  trust_policy: TrustPolicy;
  db_path: string;
  port: number;
}

export async function loadOrInitBrainConfig(opts: { dir: string; trustPolicy?: TrustPolicy; port?: number }): Promise<BrainConfig> {
  const path = join(opts.dir, "brain.json");
  if (await exists(path)) {
    return JSON.parse(await readText(path)) as BrainConfig;
  }
  const config: BrainConfig = {
    version: 1,
    trust_policy: opts.trustPolicy ?? "company",
    db_path: join(opts.dir, "brain.sqlite"),
    port: opts.port ?? 8787,
  };
  await writeText(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function intakeDisabledFromEnv(): boolean {
  return process.env.INTAKE_DISABLED === "true";
}
