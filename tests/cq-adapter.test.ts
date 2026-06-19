import { describe, expect, test } from "bun:test";
import { parseKnowledgeUnitList } from "../src/core/cq-adapter";

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
