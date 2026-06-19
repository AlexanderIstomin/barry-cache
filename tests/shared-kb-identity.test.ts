import { expect, test } from "bun:test";
import { loadOrCreateValidatorIdentity } from "../src/core/shared-kb-identity";
import { withTempRepo } from "./helpers";

test("creates a validator identity once and reloads the same id", async () => {
  await withTempRepo(async (repo) => {
    const a = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const b = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-19T00:00:00.000Z" });
    expect(b.validator_id).toBe(a.validator_id);
    expect(b.created_at).toBe("2026-06-18T00:00:00.000Z");
    expect(a.validator_id.startsWith("validator-")).toBe(true);
  });
});
