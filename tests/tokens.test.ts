import { describe, expect, test } from "bun:test";
import { getCounter, heuristicCounter } from "../src/core/tokens";

describe("token counter", () => {
  test("heuristic counts ~chars/4 and is monotonic", () => {
    expect(heuristicCounter.count("")).toBe(0);
    expect(heuristicCounter.count("abcd")).toBe(1);
    expect(heuristicCounter.count("abcde")).toBe(2);
    expect(heuristicCounter.count("a".repeat(40))).toBe(10);
    expect(heuristicCounter.count("a".repeat(41))).toBeGreaterThan(heuristicCounter.count("a".repeat(40)));
  });

  test("getCounter returns heuristic by default and rejects unknown names", () => {
    expect(getCounter()).toBe(heuristicCounter);
    expect(getCounter("heuristic")).toBe(heuristicCounter);
    expect(() => getCounter("gpt")).toThrow("unknown token counter: gpt");
  });
});
