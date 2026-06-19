import { expect, test } from "bun:test";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildHarvestCandidate, harvestGate, readContextHarvestSources, readLatestHarvestSources } from "../src/core/shared-kb-harvest";
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

test("buildHarvestCandidate for a decision suggests the decision_pattern kind", () => {
  const candidate = buildHarvestCandidate({ kind: "decision", summary: "Bind signatures to the full payload via recursive stable stringify" });
  expect(candidate.draft.kind).toBe("decision_pattern");
  expect(candidate.proposeCommand).toContain("--kind decision_pattern");
  expect(candidate.checklist.some((c) => /anonymiz/i.test(c))).toBe(true);
});

test("readContextHarvestSources harvests active decisions, ADRs and failures, excluding implemented facts", async () => {
  await withTempRepo(async (repo) => {
    const featDir = join(repo, "docs/context/features/demo");
    await mkdir(featDir, { recursive: true });
    await appendFile(join(featDir, "FACTS.jsonl"), `${JSON.stringify({ id: "D1", subject: "Signed intake", predicate: "binds", object: "the full payload via stable stringify", src: ["X"], status: "active", kind: "decision", updated_at: "2026-06-18T00:00:00.000Z" })}\n`);
    await appendFile(join(featDir, "FACTS.jsonl"), `${JSON.stringify({ id: "I1", subject: "foo", predicate: "lives in", object: "src/foo.ts", src: ["X"], status: "active", kind: "implemented", updated_at: "2026-06-18T00:00:00.000Z" })}\n`);
    await appendFile(join(featDir, "FACTS.jsonl"), `${JSON.stringify({ id: "D2", subject: "old", predicate: "was", object: "superseded", src: ["X"], status: "superseded", kind: "decision", updated_at: "2026-06-18T00:00:00.000Z" })}\n`);

    const adrDir = join(repo, "docs/context/adrs");
    await mkdir(adrDir, { recursive: true });
    await appendFile(join(adrDir, "ADR-0001-demo.md"), `---\nid: ADR-0001\ntitle: Use signed snapshots\nstatus: active\ndate: 2026-06-18\nsupersedes: []\ntags: [demo]\n---\n\n# ADR-0001\n\n## Decision\n\nSign manifests with Ed25519 and pin the key.\n`);

    const failDir = join(repo, ".context-state/failures");
    await mkdir(failDir, { recursive: true });
    await appendFile(join(failDir, "failures.jsonl"), `${JSON.stringify({ id: "f1", status: "open", summary: "Recurring validation failure after handoff", expected: "validate passes", actual: "validate fails" })}\n`);

    const { sources } = await readContextHarvestSources({ repo });
    const summaries = sources.map((s) => s.summary);
    expect(sources.some((s) => s.kind === "decision" && s.summary.includes("Signed intake"))).toBe(true);
    expect(sources.some((s) => s.kind === "decision" && s.summary.includes("Use signed snapshots"))).toBe(true);
    expect(sources.some((s) => s.kind === "failure" && s.summary.includes("Recurring validation failure"))).toBe(true);
    // implemented + superseded facts are excluded
    expect(summaries.some((s) => s.includes("lives in"))).toBe(false);
    expect(summaries.some((s) => s.includes("superseded"))).toBe(false);
  });
});
