import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { signAttestation, validateAttestation, verifyAttestationSignature, type SharedKbAttestationBody } from "../src/core/shared-kb-attestation";
import { deriveValidatorId } from "../src/core/shared-kb-intake";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyB64: Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString()).toString("base64"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function body(overrides: Partial<SharedKbAttestationBody> = {}): SharedKbAttestationBody {
  const { publicKeyB64 } = keypair();
  return {
    id: "attest-1",
    lesson_id: "lesson-20260601-aaaa1111",
    validator_id: deriveValidatorId(publicKeyB64),
    result: "confirmed",
    confidence: 0.8,
    context_tags: ["cli", "typescript"],
    evidence_type: "observed_success",
    upstream_seen: [],
    created_at: "2026-06-18T00:00:00.000Z",
    public_key: publicKeyB64,
    ...overrides,
  };
}

test("validateAttestation accepts a well-formed record and rejects bad fields", () => {
  expect(validateAttestation(body())).toBeNull();
  expect(validateAttestation({ ...body(), result: "maybe" })).toMatch(/result/);
  expect(validateAttestation({ ...body(), confidence: 1.5 })).toMatch(/confidence/);
  expect(validateAttestation({ ...body(), evidence_type: "vibes" })).toMatch(/evidence_type/);
});

test("signAttestation produces a record that verifies; tampering or id mismatch fails", () => {
  const { publicKeyB64, privateKeyPem } = keypair();
  const att = signAttestation(body({ public_key: publicKeyB64, validator_id: deriveValidatorId(publicKeyB64) }), privateKeyPem);
  expect(verifyAttestationSignature(att)).toBe(true);

  expect(verifyAttestationSignature({ ...att, result: "contradicted" })).toBe(false);
  expect(verifyAttestationSignature({ ...att, validator_id: "validator-sha256-imposter" })).toBe(false);
});
