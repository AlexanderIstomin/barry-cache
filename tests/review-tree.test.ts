import { describe, expect, test } from "bun:test";
import { buildReviewTree } from "../src/core/review-tree";
import type { FactRecord } from "../src/core/types";

function fact(overrides: Partial<FactRecord> & Pick<FactRecord, "id" | "subject" | "predicate" | "object" | "src">): FactRecord {
  return {
    status: "active",
    kind: "implemented",
    updated_at: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildReviewTree", () => {
  test("builds feature summaries, groups, and related fact indexes", () => {
    const tree = buildReviewTree([
      {
        route: "renderer-runtime",
        source: "docs/context/features/renderer-runtime/FACTS.jsonl#RR001",
        fact: fact({
          id: "RR001",
          subject: "U1",
          predicate: "defines",
          object: "D1",
          src: ["src/runtime.ts"],
          kind: "constraint",
          status: "active",
        }),
      },
      {
        route: "renderer-runtime",
        source: "docs/context/features/renderer-runtime/FACTS.jsonl#RR002",
        fact: fact({
          id: "RR002",
          subject: "U1",
          predicate: "uses",
          object: "D2",
          src: ["src/sync.ts"],
          kind: "implemented",
          status: "superseded",
        }),
      },
      {
        route: "export-pipeline",
        source: "docs/context/features/export-pipeline/FACTS.jsonl#EX001",
        fact: fact({
          id: "EX001",
          subject: "U9",
          predicate: "cites",
          object: "D1",
          src: ["src/export.ts"],
          kind: "decision",
          status: "active",
        }),
      },
    ]);

    expect(tree.features.map((feature) => feature.slug)).toEqual(["export-pipeline", "renderer-runtime"]);
    expect(tree.features.find((feature) => feature.slug === "renderer-runtime")).toMatchObject({
      factCount: 2,
      entityCount: 3,
      sourceCount: 2,
      statusCounts: { active: 1, superseded: 1 },
      kindCounts: { constraint: 1, implemented: 1 },
      predicateCounts: { defines: 1, uses: 1 },
    });
    expect(tree.factIdsByRoute["renderer-runtime"]).toEqual(["RR001", "RR002"]);
    expect(tree.factKeysByRoute["renderer-runtime"]).toEqual(["renderer-runtime::RR001", "renderer-runtime::RR002"]);
    expect(tree.factIdsByEntity["U1"]).toEqual(["RR001", "RR002"]);
    expect(tree.factKeysByEntity["U1"]).toEqual(["renderer-runtime::RR001", "renderer-runtime::RR002"]);
    expect(tree.factIdsByEntity["D1"]).toEqual(["EX001", "RR001"]);
    expect(tree.factKeysByEntity["D1"]).toEqual(["export-pipeline::EX001", "renderer-runtime::RR001"]);
    expect(tree.factIdsBySource["src/runtime.ts"]).toEqual(["RR001"]);
    expect(tree.factKeysBySource["src/runtime.ts"]).toEqual(["renderer-runtime::RR001"]);
    expect(tree.groups).toContainEqual(expect.objectContaining({
      id: "tree:group:renderer-runtime:kind:constraint",
      route: "renderer-runtime",
      groupBy: "kind",
      value: "constraint",
      factIds: ["RR001"],
      factKeys: ["renderer-runtime::RR001"],
    }));
  });

  test("keeps duplicate fact ids distinct across features in fact keys", () => {
    const tree = buildReviewTree([
      {
        route: "alpha",
        source: "docs/context/features/alpha/FACTS.jsonl#AF001",
        fact: fact({
          id: "AF001",
          subject: "Shared",
          predicate: "owns",
          object: "Alpha",
          src: ["src/shared.ts"],
        }),
      },
      {
        route: "beta",
        source: "docs/context/features/beta/FACTS.jsonl#AF001",
        fact: fact({
          id: "AF001",
          subject: "Shared",
          predicate: "uses",
          object: "Beta",
          src: ["src/shared.ts"],
        }),
      },
    ]);

    expect(tree.factIdsByEntity["Shared"]).toEqual(["AF001"]);
    expect(tree.factKeysByEntity["Shared"]).toEqual(["alpha::AF001", "beta::AF001"]);
    expect(tree.factKeysBySource["src/shared.ts"]).toEqual(["alpha::AF001", "beta::AF001"]);
  });
});
