import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BudgetReport } from "./budget";
import { readTextIfExists, repoPath } from "./fs";
import { round4 } from "./math";

export type StatsCommand = "load" | "resume";

export interface StatsEvent {
  schema_version: 1;
  id: string;
  created_at: string;
  command: StatsCommand;
  routes: string[];
  budget: number;
  used_tokens: number;
  baseline_tokens: number;
  saved_tokens: number;
  saved_pct: number;
  dropped_count: number;
  overflow: number;
  counter: "heuristic";
}

export interface StatsSummary {
  event_count: number;
  baseline_tokens: number;
  used_tokens: number;
  saved_tokens: number;
  saved_pct: number;
  load_count: number;
  resume_count: number;
  dropped_count: number;
  overflow_count: number;
  first_event_at: string | null;
  last_event_at: string | null;
  since: string | null;
}

export async function recordStatsEvent(options: {
  repo: string;
  command: StatsCommand;
  routes: string[];
  budget: BudgetReport;
  now?: string;
}): Promise<{ saved: true; path: string; event: StatsEvent }> {
  const now = options.now ?? new Date().toISOString();
  const path = statsPath(options.repo);
  const event: StatsEvent = {
    schema_version: 1,
    id: `stats-${now}-${randomUUID().slice(0, 8)}`,
    created_at: now,
    command: options.command,
    routes: options.routes,
    budget: options.budget.budget,
    used_tokens: options.budget.used,
    baseline_tokens: options.budget.baseline_tokens,
    saved_tokens: Math.max(0, options.budget.baseline_tokens - options.budget.used),
    saved_pct: options.budget.baseline_tokens > 0 ? Math.max(0, round4(1 - options.budget.used / options.budget.baseline_tokens)) : 0,
    dropped_count: options.budget.dropped.length,
    overflow: options.budget.overflow,
    counter: "heuristic",
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
  return { saved: true, path: ".context-state/stats/events.jsonl", event };
}

export async function readStatsEvents(options: { repo: string; since?: Date | undefined }): Promise<StatsEvent[]> {
  const text = await readTextIfExists(statsPath(options.repo));
  const events: StatsEvent[] = [];
  for (const row of text.split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(row) as unknown;
      if (isStatsEvent(parsed) && isAfterSince(parsed.created_at, options.since)) events.push(parsed);
    } catch {
      // Operational stats must not make Barry unusable if one row is corrupted.
    }
  }
  return events.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export async function summarizeStats(options: { repo: string; since?: Date | undefined }): Promise<StatsSummary> {
  const events = await readStatsEvents(options);
  const baseline = sum(events.map((event) => event.baseline_tokens));
  const used = sum(events.map((event) => event.used_tokens));
  const saved = sum(events.map((event) => event.saved_tokens));
  return {
    event_count: events.length,
    baseline_tokens: baseline,
    used_tokens: used,
    saved_tokens: saved,
    saved_pct: baseline > 0 ? round4(saved / baseline) : 0,
    load_count: events.filter((event) => event.command === "load").length,
    resume_count: events.filter((event) => event.command === "resume").length,
    dropped_count: sum(events.map((event) => event.dropped_count)),
    overflow_count: events.filter((event) => event.overflow > 0).length,
    first_event_at: events[0]?.created_at ?? null,
    last_event_at: events.at(-1)?.created_at ?? null,
    since: options.since?.toISOString() ?? null,
  };
}

export function parseStatsSince(value: string | undefined, now = new Date()): Date | undefined {
  if (value === undefined || value === "all") return undefined;
  const days = /^([1-9]\d*)d$/.exec(value);
  if (days?.[1]) {
    const since = new Date(now);
    since.setUTCDate(since.getUTCDate() - Number(days[1]));
    return since;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const since = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(since.getTime())) return since;
  }
  throw new Error(`Unsupported --since value: ${value}`);
}

function isStatsEvent(value: unknown): value is StatsEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return event.schema_version === 1 &&
    typeof event.id === "string" &&
    typeof event.created_at === "string" &&
    (event.command === "load" || event.command === "resume") &&
    Array.isArray(event.routes) && event.routes.every((route) => typeof route === "string") &&
    typeof event.budget === "number" &&
    typeof event.used_tokens === "number" &&
    typeof event.baseline_tokens === "number" &&
    typeof event.saved_tokens === "number" &&
    typeof event.saved_pct === "number" &&
    typeof event.dropped_count === "number" &&
    typeof event.overflow === "number" &&
    event.counter === "heuristic";
}

function isAfterSince(timestamp: string, since: Date | undefined): boolean {
  if (!since) return true;
  const time = Date.parse(timestamp);
  return !Number.isNaN(time) && time >= since.getTime();
}

function statsPath(repo: string): string {
  return repoPath(repo, ".context-state/stats/events.jsonl");
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
