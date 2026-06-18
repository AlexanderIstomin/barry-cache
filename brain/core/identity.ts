import { createHash, generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { exists, readText, writeText } from "../../src/core/fs";

export interface BrainIdentity {
  public_key_pem: string;
  private_key_pem: string;
  fingerprint: string;
  created_at: string;
}

export function brainFingerprint(publicKeyPem: string): string {
  return `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`;
}

export async function loadOrCreateBrainIdentity(opts: { dir: string; now: string }): Promise<BrainIdentity> {
  const path = join(opts.dir, "identity.json");
  if (await exists(path)) {
    const stored = JSON.parse(await readText(path)) as Omit<BrainIdentity, "fingerprint">;
    return { ...stored, fingerprint: brainFingerprint(stored.public_key_pem) };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const public_key_pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const private_key_pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const stored = { public_key_pem, private_key_pem, created_at: opts.now };
  await writeText(path, `${JSON.stringify(stored, null, 2)}\n`);
  return { ...stored, fingerprint: brainFingerprint(public_key_pem) };
}
