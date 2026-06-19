import { describe, expect, test } from "bun:test";
import { scoreText, tokens, validateSharedKbLesson, type SharedKbLesson } from "../src/core/shared-kb";

function validLesson(overrides: Partial<SharedKbLesson> = {}): SharedKbLesson {
  return {
    id: "lesson-20260603-a8f3",
    kind: "anti_pattern",
    status: "trusted",
    title: "Treat handoffs as claims until validated",
    problem: "Agents may treat previous handoff summaries as proof of correctness.",
    applies_when: ["multi-agent coding workflow"],
    recommendation: "Record user-observed failures as contradiction events.",
    why: "This prevents stale claims from becoming canonical truth.",
    avoid_when: ["the source cannot be safely anonymized"],
    confidence: "high",
    evidence: { source_type: "community_report", count: 1, has_follow_up_fix: true },
    tags: ["agents", "validation"],
    updated_at: "2026-06-03T10:00:00.000Z",
    ...overrides,
  };
}

describe("validateSharedKbLesson", () => {
  test("accepts a well-formed lesson", () => {
    expect(validateSharedKbLesson(validLesson())).toEqual([]);
  });

  test("reports missing required fields", () => {
    const { recommendation, ...partial } = validLesson();
    expect(validateSharedKbLesson(partial)).toContain("missing required field: recommendation");
  });

  test("rejects an invalid id and unknown kind", () => {
    expect(validateSharedKbLesson(validLesson({ id: "nope" }))).toContain("invalid field: id");
    expect(validateSharedKbLesson(validLesson({ kind: "made_up" as SharedKbLesson["kind"] }))).toContain("invalid field: kind");
  });

  test("rejects empty applies_when, avoid_when, or tags (cq requires at least one domain)", () => {
    expect(validateSharedKbLesson(validLesson({ tags: [] }))).toContain("invalid field: tags");
    expect(validateSharedKbLesson(validLesson({ applies_when: [] }))).toContain("invalid field: applies_when");
    expect(validateSharedKbLesson(validLesson({ avoid_when: [] }))).toContain("invalid field: avoid_when");
  });

  test("flags revealing file paths, emails, secrets, and non-example URLs", () => {
    expect(validateSharedKbLesson(validLesson({ problem: "see src/core/secret.ts" }))).toContain("field problem contains revealing file path: src/core/secret.ts");
    expect(validateSharedKbLesson(validLesson({ why: "ping me at dev@acme.com" }))).toContain("field why contains email address");
    expect(validateSharedKbLesson(validLesson({ recommendation: "use ghp_abcdefgh1234" }))).toContain("field recommendation contains secret-looking token");
    expect(validateSharedKbLesson(validLesson({ title: "see https://acme.internal/x" }))).toContain("field title contains non-example URL");
  });
});

describe("tokens / scoreText", () => {
  test("tokenizes to unique words of length >= 3", () => {
    expect(tokens("Flaky CI tests, a b c")).toEqual(["flaky", "tests"]);
  });

  test("scores the count of query tokens present in the text", () => {
    expect(scoreText("ci flaky tests pass", tokens("flaky tests"))).toBe(2);
    expect(scoreText("unrelated content", tokens("flaky tests"))).toBe(0);
  });

  test("scoring is case-insensitive on the haystack", () => {
    expect(scoreText("CI Flaky TESTS pass", tokens("flaky tests"))).toBe(2);
  });
});
