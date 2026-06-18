import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { stableStringify, validatorIdFromPem } from "./shared-kb-intake";

export type SharedKbAttestationResult = "confirmed" | "contradicted" | "not_applicable";
export type SharedKbAttestationEvidence = "observed_success" | "observed_failure" | "static_review";

export interface SharedKbAttestation {
  id: string;
  lesson_id: string;
  validator_id: string;
  result: SharedKbAttestationResult;
  confidence: number;
  context_tags: string[];
  evidence_type: SharedKbAttestationEvidence;
  upstream_seen: string[];
  created_at: string;
  public_key: string; // base64-encoded SPKI PEM
  signature: string; // base64
}

export type SharedKbAttestationBody = Omit<SharedKbAttestation, "signature">;

export function validateAttestation(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "attestation must be an object";
  const a = value as Record<string, unknown>;
  for (const f of ["id", "lesson_id", "validator_id", "created_at", "public_key"]) {
    if (typeof a[f] !== "string" || (a[f] as string).trim() === "") return `invalid field: ${f}`;
  }
  if (!["confirmed", "contradicted", "not_applicable"].includes(String(a.result))) return "invalid field: result";
  if (!["observed_success", "observed_failure", "static_review"].includes(String(a.evidence_type))) return "invalid field: evidence_type";
  if (typeof a.confidence !== "number" || a.confidence < 0.01 || a.confidence > 0.99) return "invalid field: confidence";
  if (!Array.isArray(a.context_tags) || (a.context_tags as unknown[]).some((t) => typeof t !== "string")) return "invalid field: context_tags";
  if (!Array.isArray(a.upstream_seen) || (a.upstream_seen as unknown[]).some((t) => typeof t !== "string")) return "invalid field: upstream_seen";
  return null;
}

export function signAttestation(body: SharedKbAttestationBody, privateKeyPem: string): SharedKbAttestation {
  const signature = sign(null, Buffer.from(stableStringify(body)), createPrivateKey(privateKeyPem)).toString("base64");
  return { ...body, signature };
}

export function verifyAttestationSignature(att: SharedKbAttestation): boolean {
  try {
    const { signature, ...body } = att;
    const pem = Buffer.from(att.public_key, "base64").toString("utf8");
    if (att.validator_id !== validatorIdFromPem(pem)) return false;
    return verify(null, Buffer.from(stableStringify(body)), createPublicKey(pem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
