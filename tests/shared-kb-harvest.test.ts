import { expect, test } from "bun:test";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildHarvestCandidate, harvestGate, readLatestHarvestSources } from "../src/core/shared-kb-harvest";
import { withTempRepo } from "./helpers";

test("harvestGate recommends harvesting a validated failure", () => {
  const gate = harvestGate({ kind: "failure", summary: "Validation regression after handoff", expected: "validate passes", actual: "validate fails" });
  expect(gate.harvest).toBe(true);
  expect(gate.reasons.length).toBeGreaterThan(0);
});

test("harvestGate skips a trivial cosmetic change", () => {
  const gate = harvestGate({ kind: "success", summary: "Rename button label and fix a typo" });
  expect(gate.harvest).toBe(false);
});

test("buildHarvestCandidate yields a draft, a sanitization checklist, and a propose command", () => {
  const candidate = buildHarvestCandidate({ kind: "failure", summary: "Recurring auth schema migration failure", expected: "migration succeeds", actual: "migration throws", files: ["src/db/migrate.ts"] });
  expect(candidate.gate.harvest).toBe(true);
  expect(candidate.draft.title.length).toBeGreaterThan(0);
  expect(candidate.checklist.some((c) => /anonymiz/i.test(c))).toBe(true);
  expect(candidate.checklist.some((c) => /drop/i.test(c))).toBe(true);
  expect(candidate.proposeCommand).toContain("kb propose lesson");
  // the draft must NOT auto-include the raw private file path in tags/applies_when
  expect(JSON.stringify(candidate.draft)).not.toContain("src/db/migrate.ts");
});

test("readLatestHarvestSources reads the latest handoff and failure from operational memory", async () => {
  await withTempRepo(async (repo) => {
    const handoffs = join(repo, ".context-state/handoffs");
    await mkdir(handoffs, { recursive: true });
    await appendFile(join(handoffs, "handoffs.jsonl"), `${JSON.stringify({ id: "h1", status: "partial", summary: "old", files: [] })}\n`);
    await appendFile(join(handoffs, "handoffs.jsonl"), `${JSON.stringify({ id: "h2", status: "success", summary: "Implemented signed intake batches", files: ["src/core/x.ts"] })}\n`);
    const failures = join(repo, ".context-state/failures");
    await mkdir(failures, { recursive: true });
    await appendFile(join(failures, "failures.jsonl"), `${JSON.stringify({ id: "f1", status: "open", summary: "Recurring validation failure", expected: "ok", actual: "broken", files: [] })}\n`);

    const sources = await readLatestHarvestSources({ repo });
    const kinds = sources.map((s) => s.kind).sort();
    expect(kinds).toEqual(["failure", "success"]);
    expect(sources.find((s) => s.kind === "success")?.summary).toBe("Implemented signed intake batches");
  });
});

test("readLatestHarvestSources returns empty when there is no operational memory", async () => {
  await withTempRepo(async (repo) => {
    expect(await readLatestHarvestSources({ repo })).toEqual([]);
  });
});
