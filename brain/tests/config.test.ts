import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrInitBrainConfig } from "../core/config";

test("init writes a company config with defaults and reloads it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cfg-"));
  try {
    const created = await loadOrInitBrainConfig({ dir });
    expect(created.trust_policy).toBe("company");
    expect(created.port).toBe(8787);
    expect(created.db_path).toBe(join(dir, "brain.sqlite"));

    const reloaded = await loadOrInitBrainConfig({ dir, trustPolicy: "global" }); // existing file wins
    expect(reloaded.trust_policy).toBe("company");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init honors an explicit trust policy and port on first creation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cfg2-"));
  try {
    const created = await loadOrInitBrainConfig({ dir, trustPolicy: "global", port: 9000 });
    expect(created.trust_policy).toBe("global");
    expect(created.port).toBe(9000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
