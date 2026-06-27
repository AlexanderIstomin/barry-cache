import { describe, expect, test } from "bun:test";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { recordStatsEvent, readStatsEvents, summarizeStats, parseStatsSince } from "../src/core/stats";
import { withTempRepo } from "./helpers";

describe("stats", () => {
  test("records compact token savings events and summarizes totals", async () => {
    await withTempRepo(async (repo) => {
      await recordStatsEvent({
        repo,
        now: "2026-06-20T10:00:00.000Z",
        command: "load",
        routes: ["context-loading"],
        budget: {
          budget: 2000,
          used: 800,
          baseline_tokens: 2000,
          saved_pct: 0.6,
          overflow: 0,
          dropped: ["A", "B"],
          unknown_expand: [],
          expand_hint: "",
        },
      });
      await recordStatsEvent({
        repo,
        now: "2026-06-20T10:01:00.000Z",
        command: "resume",
        routes: ["init-bootstrap"],
        budget: {
          budget: 2000,
          used: 1200,
          baseline_tokens: 2400,
          saved_pct: 0.5,
          overflow: 10,
          dropped: [],
          unknown_expand: [],
          expand_hint: "",
        },
      });

      const events = await readStatsEvents({ repo });
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(expect.objectContaining({
        schema_version: 1,
        command: "load",
        routes: ["context-loading"],
        used_tokens: 800,
        baseline_tokens: 2000,
        saved_tokens: 1200,
        dropped_count: 2,
        counter: "heuristic",
      }));

      const summary = await summarizeStats({ repo });
      expect(summary).toEqual(expect.objectContaining({
        event_count: 2,
        baseline_tokens: 4400,
        used_tokens: 2000,
        saved_tokens: 2400,
        saved_pct: 0.5455,
        load_count: 1,
        resume_count: 1,
        overflow_count: 1,
      }));
    });
  });

  test("clamps per-event savings when emitted output exceeds baseline", async () => {
    await withTempRepo(async (repo) => {
      await recordStatsEvent({
        repo,
        now: "2026-06-20T10:00:00.000Z",
        command: "load",
        routes: ["context-loading"],
        budget: {
          budget: 100,
          used: 150,
          baseline_tokens: 100,
          saved_pct: 0,
          overflow: 50,
          dropped: [],
          unknown_expand: [],
          expand_hint: "",
        },
      });

      const events = await readStatsEvents({ repo });
      expect(events[0]).toEqual(expect.objectContaining({
        saved_tokens: 0,
        saved_pct: 0,
      }));
    });
  });

  test("skips malformed event rows instead of failing the summary", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, ".context-state/stats"), { recursive: true });
      await appendFile(join(repo, ".context-state/stats/events.jsonl"), "not-json\n");
      await appendFile(join(repo, ".context-state/stats/events.jsonl"), `${JSON.stringify({ command: "load" })}\n`);
      await recordStatsEvent({
        repo,
        now: "2026-06-20T10:00:00.000Z",
        command: "load",
        routes: ["context-loading"],
        budget: {
          budget: 100,
          used: 40,
          baseline_tokens: 100,
          saved_pct: 0.6,
          overflow: 0,
          dropped: [],
          unknown_expand: [],
          expand_hint: "",
        },
      });

      const events = await readStatsEvents({ repo });
      expect(events).toHaveLength(1);
      expect((await summarizeStats({ repo })).event_count).toBe(1);
    });
  });

  test("filters summaries with parsed since windows", async () => {
    await withTempRepo(async (repo) => {
      await recordStatsEvent({
        repo,
        now: "2026-06-01T10:00:00.000Z",
        command: "load",
        routes: ["old"],
        budget: {
          budget: 100,
          used: 80,
          baseline_tokens: 100,
          saved_pct: 0.2,
          overflow: 0,
          dropped: [],
          unknown_expand: [],
          expand_hint: "",
        },
      });
      await recordStatsEvent({
        repo,
        now: "2026-06-25T10:00:00.000Z",
        command: "resume",
        routes: ["new"],
        budget: {
          budget: 100,
          used: 25,
          baseline_tokens: 100,
          saved_pct: 0.75,
          overflow: 0,
          dropped: [],
          unknown_expand: [],
          expand_hint: "",
        },
      });

      const since = parseStatsSince("7d", new Date("2026-06-26T00:00:00.000Z"));
      const summary = await summarizeStats({ repo, since });
      expect(summary.event_count).toBe(1);
      expect(summary.saved_tokens).toBe(75);
      expect(summary.resume_count).toBe(1);
    });
  });

  test("parses all, day windows, and ISO dates while rejecting unsupported values", () => {
    const now = new Date("2026-06-26T12:00:00.000Z");
    expect(parseStatsSince(undefined, now)).toBeUndefined();
    expect(parseStatsSince("all", now)).toBeUndefined();
    expect(parseStatsSince("7d", now)?.toISOString()).toBe("2026-06-19T12:00:00.000Z");
    expect(parseStatsSince("2026-06-01", now)?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(() => parseStatsSince("yesterday", now)).toThrow("Unsupported --since value");
  });
});
