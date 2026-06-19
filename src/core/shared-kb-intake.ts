/**
 * Deterministic JSON with object keys sorted recursively at every level.
 * Used to derive stable content hashes (e.g. lesson proposal ids).
 */
export function stableStringify(value: unknown): string {
  // JSON.stringify returns undefined for undefined/functions/symbols; coerce to "null"
  // (matching JSON array semantics) so the helper is total and safe to hash.
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) items.push(stableStringify((value as unknown[])[i]));
    return `[${items.join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}
