import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBrainCli } from "../cli";

test("barry-brain init scaffolds config + identity and prints the pin fingerprint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cli-"));
  try {
    const out = await runBrainCli(["init", "--dir", dir, "--trust-policy", "company"]);
    expect(out.code).toBe(0);
    const cfg = JSON.parse(await readFile(join(dir, "brain.json"), "utf8"));
    expect(cfg.trust_policy).toBe("company");
    const id = JSON.parse(await readFile(join(dir, "identity.json"), "utf8"));
    expect(typeof id.public_key_pem).toBe("string");
    expect(out.stdout).toContain("sha256:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("barry-brain migrate creates the database schema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cli2-"));
  try {
    await runBrainCli(["init", "--dir", dir]);
    const out = await runBrainCli(["migrate", "--dir", dir]);
    expect(out.code).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("migrat");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("barry-brain rejects an unknown command", async () => {
  const out = await runBrainCli(["frobnicate"]);
  expect(out.code).toBe(1);
  expect(out.stdout.toLowerCase()).toContain("usage");
});
