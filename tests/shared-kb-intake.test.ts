import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { deriveValidatorId, signIntakeBatch, stableStringify, validatorIdFromPem, verifyIntakeBatchSignature, type IntakeItem } from "../src/core/shared-kb-intake";
import { loadOrCreateValidatorIdentity } from "../src/core/shared-kb-identity";
import { withTempRepo } from "./helpers";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const items: IntakeItem[] = [{ type: "lesson", record: { id: "lesson-1", title: "T", nested: { b: 2, a: 1 } } }];

test("stableStringify sorts keys recursively and is deterministic", () => {
  expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  expect(stableStringify({ a: { c: 3, d: 4 }, b: 1 })).toBe('{"a":{"c":3,"d":4},"b":1}');
});

test("signIntakeBatch produces a batch that verifies", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  const batch = signIntakeBatch({ version: 1, validator_id: "v", public_key: Buffer.from(publicKeyPem).toString("base64"), items }, privateKeyPem);
  expect(verifyIntakeBatchSignature(batch)).toBe(true);
});

test("signature binds item contents: tampering with a record fails verification", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  const batch = signIntakeBatch({ version: 1, validator_id: "v", public_key: Buffer.from(publicKeyPem).toString("base64"), items }, privateKeyPem);
  const tampered = { ...batch, items: [{ type: "lesson" as const, record: { id: "lesson-1", title: "EVIL", nested: { b: 2, a: 1 } } }] };
  expect(verifyIntakeBatchSignature(tampered)).toBe(false);
});

test("deriveValidatorId derives a stable id from the base64 public key, matching validatorIdFromPem", () => {
  const { publicKeyPem } = keypair();
  const base64 = Buffer.from(publicKeyPem).toString("base64");
  expect(deriveValidatorId(base64)).toBe(validatorIdFromPem(publicKeyPem));
  expect(deriveValidatorId(base64).startsWith("validator-sha256-")).toBe(true);
});

test("a client identity's validator_id equals the server-derived id for its batch public key", async () => {
  await withTempRepo(async (repo) => {
    const identity = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const batchPublicKey = Buffer.from(identity.public_key_pem).toString("base64");
    expect(deriveValidatorId(batchPublicKey)).toBe(identity.validator_id);
  });
});

test("verification fails for a garbage signature", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  const batch = signIntakeBatch({ version: 1, validator_id: "v", public_key: Buffer.from(publicKeyPem).toString("base64"), items }, privateKeyPem);
  expect(verifyIntakeBatchSignature({ ...batch, signature: Buffer.from("nope").toString("base64") })).toBe(false);
});
