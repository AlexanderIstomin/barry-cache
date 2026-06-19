import { expect, test } from "bun:test";
import { stableStringify } from "../src/core/shared-kb-intake";

test("stableStringify sorts keys recursively and is deterministic", () => {
  expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  expect(stableStringify({ a: { c: 3, d: 4 }, b: 1 })).toBe('{"a":{"c":3,"d":4},"b":1}');
});
