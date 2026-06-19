import { describe, expect, test } from "bun:test";
import { buildProvenanceNote, cqContribute, cqSearch, cqUnitToSearchItem, lessonToCqProposal, parseKnowledgeUnitList } from "../src/core/cq-adapter";
import type { SharedKbLesson } from "../src/core/shared-kb";

function sampleLesson(overrides: Partial<SharedKbLesson> = {}): SharedKbLesson {
  return {
    id: "lesson-20260619-abcd1234",
    kind: "lesson",
    status: "submitted",
    title: "Validate handoffs before trusting them",
    problem: "Agents trust stale handoff summaries.",
    applies_when: ["multi-agent workflow"],
    recommendation: "Validate claims before treating them as durable context.",
    why: "Stale operational memory becomes false canonical truth.",
    avoid_when: ["the source cannot be anonymized"],
    confidence: "medium",
    evidence: { source_type: "community_report", count: 2, has_follow_up_fix: true },
    tags: ["agents", "validation"],
    updated_at: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseKnowledgeUnitList", () => {
  test("unwraps the data array and reads next_cursor", () => {
    const parsed = parseKnowledgeUnitList({
      data: [{ id: "ku_1", insight: { summary: "x" } }],
      next_cursor: "abc",
    });
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0]?.id).toBe("ku_1");
    expect(parsed.nextCursor).toBe("abc");
  });

  test("defaults next_cursor to null for an unpaginated list", () => {
    const parsed = parseKnowledgeUnitList({ data: [] });
    expect(parsed.units).toEqual([]);
    expect(parsed.nextCursor).toBeNull();
  });

  test("throws when data is missing or malformed", () => {
    expect(() => parseKnowledgeUnitList({})).toThrow("cq response missing data array");
    expect(() => parseKnowledgeUnitList({ data: [{ insight: {} }] })).toThrow("cq knowledge unit missing id");
  });
});

describe("cqUnitToSearchItem", () => {
  test("maps insight, domains, evidence confidence, context, and status from authoritative cq fields", () => {
    const item = cqUnitToSearchItem({
      id: "ku_42",
      domains: ["testing", "ci"],
      insight: { summary: "Flaky retries", detail: "Tests retry under load", action: "Pin the seed" },
      context: { languages: ["typescript"], frameworks: ["bun"], pattern: "retry" },
      evidence: { confidence: 0.7, last_confirmed: "2026-06-01T00:00:00.000Z" },
    });
    expect(item.id).toBe("ku_42");
    expect(item.kind).toBe("lesson"); // cq has no kind taxonomy
    expect(item.status).toBe("trusted"); // evidence.confidence >= 0.6
    expect(item.confidence).toBe("high"); // >= 0.66
    expect(item.title).toBe("Flaky retries");
    expect(item.summary).toBe("Tests retry under load Pin the seed");
    expect(item.tags).toEqual(["testing", "ci"]);
    expect(item.updated_at).toBe("2026-06-01T00:00:00.000Z");
    expect(item.text).toContain("typescript");
  });

  test("low evidence confidence maps to reviewed/low; flags map to challenged", () => {
    const reviewed = cqUnitToSearchItem({ id: "ku_1", domains: ["x"], insight: { summary: "s" }, evidence: { confidence: 0.1 } });
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.confidence).toBe("low");
    expect(reviewed.title).toBe("s");

    const flagged = cqUnitToSearchItem({ id: "ku_2", domains: ["x"], insight: { summary: "s" }, evidence: { confidence: 0.9 }, flags: [{ reason: "stale" }] });
    expect(flagged.status).toBe("challenged");
  });
});

function fakeFetch(body: unknown, captured: { url?: string; auth?: string | null }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    captured.url = String(input);
    captured.auth = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("cqSearch", () => {
  test("returns only units matching all query tokens, scored and sorted", async () => {
    const captured: { url?: string; auth?: string | null } = {};
    const body = {
      data: [
        { id: "ku_hit", domains: ["ci"], evidence: { confidence: 0.8 }, insight: { summary: "retry storms", detail: "ci flaky tests", action: "pin" } },
        { id: "ku_miss", domains: ["db"], evidence: { confidence: 0.9 }, insight: { summary: "unrelated", detail: "database", action: "index" } },
      ],
    };
    const result = await cqSearch({
      endpoint: "https://cq.example.com",
      query: "flaky tests",
      apiKey: "secret",
      fetchImpl: fakeFetch(body, captured),
    });
    expect(result.results.map((r) => r.id)).toEqual(["ku_hit"]);
    expect(result.results[0]?.score).toBe(2);
    expect(captured.url).toBe("https://cq.example.com/api/v1/knowledge");
    expect(captured.auth).toBe("Bearer secret");
  });

  test("passes domains as a query parameter", async () => {
    const captured: { url?: string; auth?: string | null } = {};
    await cqSearch({
      endpoint: "https://cq.example.com/",
      query: "x",
      domains: ["testing", "ci"],
      fetchImpl: fakeFetch({ data: [] }, captured),
    });
    expect(captured.url).toBe("https://cq.example.com/api/v1/knowledge?domains=testing%2Cci");
    expect(captured.auth).toBeNull();
  });

  test("throws on a non-OK response", async () => {
    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(
      cqSearch({ endpoint: "https://cq.example.com", query: "x", fetchImpl: failing }),
    ).rejects.toThrow("cq search failed: 503");
  });
});

describe("lessonToCqProposal", () => {
  test("maps a lesson to cq propose shape with provenance in detail", () => {
    const req = lessonToCqProposal(sampleLesson(), { createdBy: "validator-xyz" });
    expect(req.domains).toEqual(["agents", "validation"]);
    expect(req.insight.summary).toBe("Validate handoffs before trusting them");
    expect(req.insight.action).toBe("Validate claims before treating them as durable context.");
    expect(req.insight.detail).toContain("Agents trust stale handoff summaries.");
    expect(req.insight.detail).toContain("Source: Barry Cache lesson lesson-20260619-abcd1234");
    expect(req.context?.pattern).toContain("applies when: multi-agent workflow");
    expect(req.context?.pattern).toContain("avoid when: the source cannot be anonymized");
    expect(req.created_by).toBe("validator-xyz");
  });

  test("throws when the lesson has no tags (cq requires >=1 domain)", () => {
    expect(() => lessonToCqProposal(sampleLesson({ tags: [] }))).toThrow("at least one domain");
  });

  test("provenance note includes evidence source and count", () => {
    expect(buildProvenanceNote(sampleLesson())).toContain("community_report, 2 observation(s), has follow-up fix");
  });
});

describe("cqContribute", () => {
  test("POSTs the proposal and returns the assigned id", async () => {
    let captured: { method?: string | undefined; body?: unknown; auth?: string | null } = {};
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      captured = { method: init?.method, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ data: { id: "ku_" + "a".repeat(32) } }), { status: 201 });
    }) as typeof fetch;
    const res = await cqContribute({
      endpoint: "https://cq.example.com/",
      proposal: { domains: ["ci"], insight: { summary: "s", detail: "d", action: "a" } },
      apiKey: "secret",
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    expect(res.id).toBe("ku_" + "a".repeat(32));
    expect(captured.method).toBe("POST");
    expect(captured.auth).toBe("Bearer secret");
    expect((captured.body as { domains: string[] }).domains).toEqual(["ci"]);
  });

  test("returns ok:false with the error body on non-2xx", async () => {
    const fetchImpl = (async () => new Response("bad domains", { status: 422 })) as unknown as typeof fetch;
    const res = await cqContribute({ endpoint: "https://cq.example.com", proposal: { domains: ["x"], insight: { summary: "s", detail: "d", action: "a" } }, fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toContain("bad domains");
  });
});
