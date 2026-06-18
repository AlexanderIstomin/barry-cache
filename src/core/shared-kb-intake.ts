import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export interface IntakeItem {
  type: "lesson" | "attestation";
  record: unknown;
}

export interface IntakeBatchBody {
  version: 1;
  validator_id: string;
  public_key: string; // base64-encoded SPKI PEM
  items: IntakeItem[];
}

export interface IntakeBatch extends IntakeBatchBody {
  signature: string; // base64
}

/**
 * Deterministic JSON with object keys sorted recursively at every level.
 * Used as the signed payload so a batch signature binds the full item
 * contents, not just the envelope. (A plain `JSON.stringify(obj, keys)`
 * array-replacer would strip nested keys and leave records unsigned.)
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function canonicalIntakePayload(body: IntakeBatchBody): string {
  return stableStringify({ version: body.version, validator_id: body.validator_id, public_key: body.public_key, items: body.items });
}

export function signIntakeBatch(body: IntakeBatchBody, privateKeyPem: string): IntakeBatch {
  const signature = sign(null, Buffer.from(canonicalIntakePayload(body)), createPrivateKey(privateKeyPem)).toString("base64");
  return { ...body, signature };
}

export function verifyIntakeBatchSignature(batch: IntakeBatch): boolean {
  try {
    const { signature, ...body } = batch;
    const pem = Buffer.from(batch.public_key, "base64").toString("utf8");
    return verify(null, Buffer.from(canonicalIntakePayload(body)), createPublicKey(pem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
