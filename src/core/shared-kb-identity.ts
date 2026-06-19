import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { exists, readText, repoPath } from "./fs";
import { validatorIdFromPem } from "./shared-kb-intake";

export interface ValidatorIdentity {
  version: 1;
  algorithm: "ed25519";
  validator_id: string;
  public_key_pem: string;
  private_key_pem: string;
  created_at: string;
}

export function validatorIdentityPath(repo: string): string {
  return repoPath(repo, ".barry-cache/shared-kb/identity.json");
}

export function validatorIdForPublicKey(publicKeyPem: string): string {
  return validatorIdFromPem(publicKeyPem);
}

export async function loadOrCreateValidatorIdentity(opts: { repo: string; now: string }): Promise<ValidatorIdentity> {
  const path = validatorIdentityPath(opts.repo);
  if (await exists(path)) {
    return JSON.parse(await readText(path)) as ValidatorIdentity;
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const public_key_pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const private_key_pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const identity: ValidatorIdentity = {
    version: 1,
    algorithm: "ed25519",
    validator_id: validatorIdForPublicKey(public_key_pem),
    public_key_pem,
    private_key_pem,
    created_at: opts.now,
  };
  // The identity file holds the validator's ed25519 private key, so write it
  // owner-only (matching the cq credentials file) even though .barry-cache/ is git-ignored.
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}
