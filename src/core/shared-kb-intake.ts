import { createHash } from "node:crypto";

/**
 * Deterministic JSON with object keys sorted recursively at every level.
 * Used to derive stable content hashes (e.g. lesson proposal ids).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Canonical validator id derived from a public key PEM. The id is a pure
 * function of the key, so a contributor identity is reproducible from its key.
 */
export function validatorIdFromPem(publicKeyPem: string): string {
  return `validator-sha256-${createHash("sha256").update(publicKeyPem).digest("hex")}`;
}
