import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformance } from "../conformance/suite";
import { createRouter } from "../http/router";
import { createBrain } from "../core/brain";
import { createSqliteStore } from "../core/store-sqlite";
import { loadOrCreateBrainIdentity } from "../core/identity";
import { startBunServer } from "../runtime/bun-server";

test("conformance suite passes against a real in-process brain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-conf-"));
  const store = createSqliteStore(":memory:");
  await store.migrate();
  const identity = await loadOrCreateBrainIdentity({ dir, now: "2026-06-18T00:00:00.000Z" });
  const brain = createBrain({ store, identity, trustPolicy: "company", now: () => "2026-06-18T00:00:00.000Z" });
  const server = startBunServer({ router: createRouter({ brain, fingerprint: identity.fingerprint }), port: 0 });
  try {
    const report = await runConformance({ baseUrl: `http://localhost:${server.port}` });
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThanOrEqual(5);
  } finally {
    server.stop();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
