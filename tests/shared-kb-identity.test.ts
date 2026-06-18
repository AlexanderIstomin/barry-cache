import { expect, test } from "bun:test";
import { loadOrCreateValidatorIdentity } from "../src/core/shared-kb-identity";
import { signIntakeBatch, verifyIntakeBatchSignature } from "../src/core/shared-kb-intake";
import { withTempRepo } from "./helpers";

test("creates a validator identity once and reloads the same id", async () => {
  await withTempRepo(async (repo) => {
    const a = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const b = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-19T00:00:00.000Z" });
    expect(b.validator_id).toBe(a.validator_id);
    expect(b.created_at).toBe("2026-06-18T00:00:00.000Z");
    expect(a.validator_id.startsWith("validator-sha256-")).toBe(true);
  });
});

test("the identity can sign an intake batch the shared verifier accepts", async () => {
  await withTempRepo(async (repo) => {
    const id = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const batch = signIntakeBatch(
      { version: 1, validator_id: id.validator_id, public_key: Buffer.from(id.public_key_pem).toString("base64"), items: [{ type: "lesson", record: { id: "lesson-1" } }] },
      id.private_key_pem,
    );
    expect(verifyIntakeBatchSignature(batch)).toBe(true);
  });
});
