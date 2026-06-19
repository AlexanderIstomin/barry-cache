import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { stableStringify, validatorIdFromPem } from "../src/core/shared-kb-intake";
import { loadOrCreateValidatorIdentity } from "../src/core/shared-kb-identity";
import { withTempRepo } from "./helpers";

test("stableStringify sorts keys recursively and is deterministic", () => {
  expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  expect(stableStringify({ a: { c: 3, d: 4 }, b: 1 })).toBe('{"a":{"c":3,"d":4},"b":1}');
});

test("validatorIdFromPem derives a stable, key-bound id", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  expect(validatorIdFromPem(pem)).toBe(validatorIdFromPem(pem));
  expect(validatorIdFromPem(pem).startsWith("validator-sha256-")).toBe(true);
});

test("a created identity's validator_id matches validatorIdFromPem of its public key", async () => {
  await withTempRepo(async (repo) => {
    const identity = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    expect(validatorIdFromPem(identity.public_key_pem)).toBe(identity.validator_id);
  });
});
