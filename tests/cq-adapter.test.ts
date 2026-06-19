import { describe, expect, test } from "bun:test";
import { cqSearch, cqUnitToSearchItem, parseKnowledgeUnitList } from "../src/core/cq-adapter";

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
  test("maps insight, kind, confidence band, and status", () => {
    const item = cqUnitToSearchItem({
      id: "ku_42",
      kind: "pitfall",
      confidence: 0.7,
      domain: ["testing", "ci"],
      insight: { summary: "Flaky retries", detail: "Tests retry under load", action: "Pin the seed" },
      last_confirmed: "2026-06-01T00:00:00.000Z",
    });
    expect(item.id).toBe("ku_42");
    expect(item.kind).toBe("anti_pattern"); // pitfall -> anti_pattern
    expect(item.status).toBe("trusted"); // confidence >= 0.6
    expect(item.confidence).toBe("high"); // >= 0.66
    expect(item.title).toBe("Flaky retries");
    expect(item.summary).toBe("Tests retry under load Pin the seed");
    expect(item.tags).toEqual(["testing", "ci"]);
    expect(item.updated_at).toBe("2026-06-01T00:00:00.000Z");
    expect(item.text).toContain("flaky retries");
  });

  test("defaults unknown kind to lesson and low confidence to reviewed/low", () => {
    const item = cqUnitToSearchItem({ id: "ku_1", confidence: 0.1, insight: { summary: "s" } });
    expect(item.kind).toBe("lesson");
    expect(item.status).toBe("reviewed");
    expect(item.confidence).toBe("low");
    expect(item.title).toBe("s");
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
        { id: "ku_hit", confidence: 0.8, insight: { summary: "retry storms", detail: "ci flaky tests", action: "pin" } },
        { id: "ku_miss", confidence: 0.9, insight: { summary: "unrelated", detail: "database", action: "index" } },
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
