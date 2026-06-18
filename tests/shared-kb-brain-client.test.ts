import { expect, test } from "bun:test";
import { buildLessonIntakeBatch, submitIntakeBatch } from "../src/core/shared-kb-brain-client";
import { loadOrCreateValidatorIdentity } from "../src/core/shared-kb-identity";
import { verifyIntakeBatchSignature } from "../src/core/shared-kb-intake";
import { buildLessonProposal } from "../src/core/shared-kb-proposal";
import { withTempRepo } from "./helpers";

const proposalInput = {
  title: "Treat handoffs as claims until validated",
  problem: "Agents may trust stale handoff summaries.",
  applies_when: ["multi-agent coding workflow"],
  recommendation: "Validate claims before treating them as durable context.",
  why: "This prevents stale operational memory from becoming canonical truth.",
  avoid_when: ["the source cannot be safely anonymized"],
  tags: ["agents", "validation"],
  confidence: "medium" as const,
};

test("buildLessonIntakeBatch produces a signed batch of lesson items", async () => {
  await withTempRepo(async (repo) => {
    const identity = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const lesson = buildLessonProposal(proposalInput, { now: "2026-06-18T10:00:00.000Z" });
    const batch = buildLessonIntakeBatch({ identity, lessons: [lesson] });
    expect(batch.validator_id).toBe(identity.validator_id);
    expect(batch.items[0]?.type).toBe("lesson");
    expect(verifyIntakeBatchSignature(batch)).toBe(true);
  });
});

test("submitIntakeBatch POSTs to /v1/intake and returns the accepted count", async () => {
  await withTempRepo(async (repo) => {
    const identity = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const batch = buildLessonIntakeBatch({ identity, lessons: [buildLessonProposal(proposalInput, { now: "2026-06-18T10:00:00.000Z" })] });
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ accepted: 1, rejected: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const result = await submitIntakeBatch({ url: "https://brain.example.com/", batch, fetch: fakeFetch });
    expect(result.ok).toBe(true);
    expect(result.accepted).toBe(1);
    expect(calls[0]?.url).toBe("https://brain.example.com/v1/intake");
    expect(calls[0]?.method).toBe("POST");
  });
});

test("submitIntakeBatch reports the kill-switch (503) without throwing", async () => {
  await withTempRepo(async (repo) => {
    const identity = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const batch = buildLessonIntakeBatch({ identity, lessons: [buildLessonProposal(proposalInput, { now: "2026-06-18T10:00:00.000Z" })] });
    const fakeFetch = (async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: "intake disabled" }), { status: 503, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await submitIntakeBatch({ url: "https://brain.example.com", batch, fetch: fakeFetch });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });
});

test("submitIntakeBatch surfaces a 400 error message", async () => {
  await withTempRepo(async (repo) => {
    const identity = await loadOrCreateValidatorIdentity({ repo, now: "2026-06-18T00:00:00.000Z" });
    const batch = buildLessonIntakeBatch({ identity, lessons: [buildLessonProposal(proposalInput, { now: "2026-06-18T10:00:00.000Z" })] });
    const fakeFetch = (async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: "signature did not verify" }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await submitIntakeBatch({ url: "https://brain.example.com", batch, fetch: fakeFetch });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("signature");
  });
});
