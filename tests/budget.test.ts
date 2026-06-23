import { describe, expect, test } from "bun:test";
import { budgetContext } from "../src/core/budget";
import { heuristicCounter } from "../src/core/tokens";
import type { FactRecord, FeaturePack } from "../src/core/types";
import type { AdrRecord } from "../src/core/adr";

function fact(id: string, over: Partial<FactRecord> = {}): FactRecord {
  return {
    id, subject: "S", predicate: "p", object: "o",
    src: ["X1"], status: "active", kind: "implemented",
    updated_at: "2026-05-01T00:00:00.000Z", ...over,
  };
}

function pack(facts: FactRecord[]): FeaturePack {
  return {
    slug: "demo", dir: "/tmp/demo",
    readme: "# Demo Pack\n\nThe demo summary paragraph.\n\nMore detail here.\n",
    idmap: "# ID Map\n- `X1`: src/demo.ts\n", graph: "A owns B\n", facts,
  };
}

const NO_ADRS: AdrRecord[] = [];

describe("budgetContext", () => {
  test("includes core summary and ranks task-relevant facts first", () => {
    const facts = [
      fact("F1", { object: "unrelated thing" }),
      fact("F2", { object: "playback drift fix", tags: ["drift"] }),
    ];
    const out = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: ["docs/context/features/demo/README.md"],
      task: "fix playback drift", budget: 100000, counter: heuristicCounter,
    });
    expect(out.feature.title).toBe("Demo Pack");
    expect(out.feature.summary).toBe("The demo summary paragraph.");
    expect(out.facts[0]?.id).toBe("F2"); // higher relevance ranked first
    expect(out.facts).toHaveLength(2); // all facts included at a huge budget
    expect(out.budget.dropped).toHaveLength(0); // nothing dropped at a huge budget
    // saved_pct is still > 0: terse prose (core summary) replaces the full README/IDMAP/KG,
    // which remain referenced via `sources` (lossless by reference).
    expect(out.budget.saved_pct).toBeGreaterThan(0);
    expect(out.budget.used).toBeLessThanOrEqual(out.budget.baseline_tokens);
  });

  test("drops lowest-ranked facts past the budget and lists them", () => {
    const facts = [fact("F1"), fact("F2"), fact("F3"), fact("F4")];
    const out = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: [],
      task: "", budget: 80, counter: heuristicCounter,
    });
    const droppedIds = out.budget.dropped.map((d) => d.id);
    // Every dropped id is still present in the source pack (lossless invariant).
    for (const id of droppedIds) {
      expect(facts.some((f) => f.id === id)).toBe(true);
    }
    expect(out.budget.used).toBeLessThanOrEqual(80);
    expect(droppedIds.length).toBeGreaterThan(0);
    expect(out.budget.saved_pct).toBeGreaterThan(0);
  });

  test("excludes superseded facts but restores them via expand", () => {
    const facts = [fact("F1"), fact("OLD", { status: "superseded" })];
    const base = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: [],
      task: "", budget: 100000, counter: heuristicCounter,
    });
    expect(base.facts.some((f) => f.id === "OLD")).toBe(false);

    const expanded = budgetContext({
      feature: pack(facts), adrs: NO_ADRS, sources: [],
      task: "", budget: 100000, counter: heuristicCounter, expand: ["OLD"],
    });
    expect(expanded.facts.some((f) => f.id === "OLD")).toBe(true);
  });

  test("summarizes ADRs by default and expands the full body on request", () => {
    const adr: AdrRecord = {
      id: "ADR-0001", title: "Use repo-native context", status: "active", date: "2026-05-19",
      supersedes: [], tags: [], path: "docs/context/adrs/ADR-0001-x.md",
      content: "The decision summary line.\n\nLong rationale that should not appear in the summary view.",
    };
    const summary = budgetContext({
      feature: pack([fact("F1")]), adrs: [adr], sources: [],
      task: "", budget: 100000, counter: heuristicCounter,
    });
    expect(summary.adrs[0]).toEqual({ id: "ADR-0001", title: "Use repo-native context", summary: "The decision summary line." });

    const full = budgetContext({
      feature: pack([fact("F1")]), adrs: [adr], sources: [],
      task: "", budget: 100000, counter: heuristicCounter, expand: ["ADR-0001"],
    });
    expect(full.adrs[0]?.summary).toContain("Long rationale");
  });

  test("forced expand is included even when it overflows the budget; overflow is reported", () => {
    const big = fact("BIG", { object: "x".repeat(400) });
    const out = budgetContext({
      feature: pack([big]), adrs: NO_ADRS, sources: [],
      task: "", budget: 10, counter: heuristicCounter, expand: ["BIG"],
    });
    expect(out.facts.some((f) => f.id === "BIG")).toBe(true);
    expect(out.budget.overflow).toBeGreaterThan(0);
  });
});
