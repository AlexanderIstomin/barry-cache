import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brainFingerprint, loadOrCreateBrainIdentity } from "../core/identity";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "brain-identity-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("creates an identity once and reloads the same keypair + fingerprint", async () => {
  await withDir(async (dir) => {
    const a = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
    const b = await loadOrCreateBrainIdentity({ dir, now: "2026-06-19T00:00:00.000Z" });
    expect(b.public_key_pem).toBe(a.public_key_pem);
    expect(b.private_key_pem).toBe(a.private_key_pem);
    expect(b.created_at).toBe("2026-06-18T00:00:00.000Z");
    expect(a.fingerprint).toBe(brainFingerprint(a.public_key_pem));
    expect(a.fingerprint.startsWith("sha256:")).toBe(true);
  });
});
