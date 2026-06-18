import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createRouter } from "../http/router";
import { createBrain, type IntakeItem } from "../core/brain";
import { createSqliteStore } from "../core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../core/identity";
import { deriveValidatorId, signIntakeBatch } from "../../src/core/shared-kb-intake";

async function makeRouter(intakeDisabled = false) {
  const dir = await mkdtemp(join(tmpdir(), "brain-router-"));
  const store = createSqliteStore(":memory:");
  await store.migrate();
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });
  const router = createRouter({ brain, intakeDisabled, fingerprint: identity.fingerprint });
  return { router, brain, cleanup: async () => { await store.close(); await rm(dir, { recursive: true, force: true }); } };
}

function signedBatch(items: IntakeItem[]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyB64 = Buffer.from(pub).toString("base64");
  return signIntakeBatch({ version: 1, validator_id: deriveValidatorId(publicKeyB64), public_key: publicKeyB64, items }, priv);
}

const lesson = { id: "lesson-20260601-aaaa1111", kind: "lesson", status: "submitted", title: "T", problem: "P", applies_when: ["x"], recommendation: "R", why: "W", avoid_when: ["y"], confidence: "high", evidence: { source_type: "community_report", count: 1 }, tags: ["cli"], updated_at: "2026-06-01T00:00:00.000Z" };

test("GET /healthz returns ok and fingerprint", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/healthz"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.fingerprint.startsWith("sha256:")).toBe(true);
  await cleanup();
});

test("POST /v1/intake returns 503 when intake disabled (kill-switch)", async () => {
  const { router, cleanup } = await makeRouter(true);
  const res = await router(new Request("http://x/v1/intake", { method: "POST", body: "{}" }));
  expect(res.status).toBe(503);
  await cleanup();
});

test("POST /v1/intake accepts a valid signed batch", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/v1/intake", { method: "POST", body: JSON.stringify(signedBatch([{ type: "lesson", record: lesson }])) }));
  expect(res.status).toBe(200);
  expect((await res.json()).accepted).toBe(1);
  await cleanup();
});

test("POST /v1/intake returns 400 when the signature does not verify", async () => {
  const { router, cleanup } = await makeRouter();
  const batch = signedBatch([{ type: "lesson", record: lesson }]);
  batch.signature = Buffer.from("nope").toString("base64");
  const res = await router(new Request("http://x/v1/intake", { method: "POST", body: JSON.stringify(batch) }));
  expect(res.status).toBe(400);
  await cleanup();
});

test("GET /v1/search without q returns 400, with q returns results array", async () => {
  const { router, cleanup } = await makeRouter();
  expect((await router(new Request("http://x/v1/search"))).status).toBe(400);
  const res = await router(new Request("http://x/v1/search?q=cli"));
  expect(res.status).toBe(200);
  expect(Array.isArray((await res.json()).results)).toBe(true);
  await cleanup();
});

test("GET /v1/snapshot returns a versioned manifest", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/v1/snapshot"));
  expect(res.status).toBe(200);
  expect((await res.json()).manifest.version).toBe(1);
  await cleanup();
});

test("GET /v1/lesson/:id returns 404 for unknown lesson", async () => {
  const { router, cleanup } = await makeRouter();
  const res = await router(new Request("http://x/v1/lesson/lesson-does-not-exist"));
  expect(res.status).toBe(404);
  await cleanup();
});

test("unknown route returns 404", async () => {
  const { router, cleanup } = await makeRouter();
  expect((await router(new Request("http://x/nope"))).status).toBe(404);
  await cleanup();
});
