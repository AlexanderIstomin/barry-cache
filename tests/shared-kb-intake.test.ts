import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { signIntakeBatch, stableStringify, verifyIntakeBatchSignature, type IntakeItem } from "../src/core/shared-kb-intake";

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

test("verification fails for a garbage signature", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  const batch = signIntakeBatch({ version: 1, validator_id: "v", public_key: Buffer.from(publicKeyPem).toString("base64"), items }, privateKeyPem);
  expect(verifyIntakeBatchSignature({ ...batch, signature: Buffer.from("nope").toString("base64") })).toBe(false);
});
