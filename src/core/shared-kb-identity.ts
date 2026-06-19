import { randomUUID } from "node:crypto";
import { exists, readText, repoPath, writeText } from "./fs";

export interface ValidatorIdentity {
  version: 1;
  validator_id: string;
  created_at: string;
}

export function validatorIdentityPath(repo: string): string {
  return repoPath(repo, ".barry-cache/shared-kb/identity.json");
}

// A stable, anonymous per-repo id used only as the `created_by` attribution on cq
// proposals. cq propose carries no signature, so there is no keypair to manage — the id
// is a random value persisted once and reused.
export async function loadOrCreateValidatorIdentity(opts: { repo: string; now: string }): Promise<ValidatorIdentity> {
  const path = validatorIdentityPath(opts.repo);
  if (await exists(path)) {
    return JSON.parse(await readText(path)) as ValidatorIdentity;
  }
  const identity: ValidatorIdentity = {
    version: 1,
    validator_id: `validator-${randomUUID()}`,
    created_at: opts.now,
  };
  await writeText(path, `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}
