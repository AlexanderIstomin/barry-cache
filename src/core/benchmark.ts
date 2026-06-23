import { join } from "node:path";
import { budgetContext } from "./budget";
import { readContextSnapshot } from "./context-cache";
import { loadContext, routeTask } from "./context";
import { readTextIfExists, repoPath, writeText } from "./fs";
import { getCounter, type TokenCounter } from "./tokens";
import { benchmarkTaskErrors, readIdmapTokens } from "./validate";

export const DEFAULT_BENCH_BUDGET = 1500;

export interface BenchmarkTask {
  id: string;
  task: string;
  expect_packs: string[];
  expect_facts?: string[];
  budget?: number;
}

export interface BenchmarkTaskResult {
  id: string;
  task: string;
  routed_packs: string[];
  baseline_tokens: number;
  loaded_tokens: number;
  tokens_saved_pct: number;
  pack_recall: number;
  fact_recall: number;
  budget_overflow: number;
}

export interface BenchmarkReport {
  tasks: BenchmarkTaskResult[];
  mean_tokens_saved_pct: number;
  mean_pack_recall: number;
  mean_fact_recall: number;
  recall_regressions: number;
  corpus_baseline_pct: number;
}

export async function readBenchmarkTasks(repo: string): Promise<{ tasks: BenchmarkTask[]; skipped: number }> {
  const text = await readTextIfExists(repoPath(repo, "docs/context/benchmarks/tasks.jsonl"));
  const tasks: BenchmarkTask[] = [];
  let skipped = 0;
  for (const row of text.split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(row) as unknown;
    } catch {
      skipped++;
      continue;
    }
    if (benchmarkTaskErrors(value).length > 0) {
      skipped++;
      continue;
    }
    tasks.push(value as BenchmarkTask);
  }
  return { tasks, skipped };
}

export async function runBenchmark({ repo, budget, counter = getCounter() }: { repo: string; budget?: number; counter?: TokenCounter }): Promise<BenchmarkReport> {
  const { tasks } = await readBenchmarkTasks(repo);
  const corpusTokens = await corpusBaselineTokens(repo, counter);
  const results: BenchmarkTaskResult[] = [];

  for (const task of tasks) {
    const routed = (await routeTask({ repo, task: task.task })).routes.slice(0, 3).map((route) => route.slug);
    const effectiveBudget = budget ?? task.budget ?? DEFAULT_BENCH_BUDGET;

    let baseline = 0;
    let loaded = 0;
    let overflow = 0;
    const includedFactIds = new Set<string>();

    for (const slug of routed) {
      const pack = await loadContext({ repo, route: slug });
      if (pack.feature === null) continue;
      const budgeted = budgetContext({
        feature: pack.feature, facts: pack.facts, adrs: pack.adrs, sources: pack.sources,
        task: task.task, budget: effectiveBudget, counter,
      });
      baseline += budgeted.budget.baseline_tokens;
      loaded += budgeted.budget.used;
      overflow += budgeted.budget.overflow;
      for (const fact of budgeted.facts) includedFactIds.add(fact.id);
    }

    const expectedPacks = task.expect_packs;
    const packHits = expectedPacks.filter((slug) => routed.includes(slug)).length;
    const expectedFacts = task.expect_facts ?? [];
    const factHits = expectedFacts.filter((id) => includedFactIds.has(id)).length;

    results.push({
      id: task.id,
      task: task.task,
      routed_packs: routed,
      baseline_tokens: baseline,
      loaded_tokens: loaded,
      tokens_saved_pct: baseline > 0 ? round4(1 - loaded / baseline) : 0,
      pack_recall: expectedPacks.length > 0 ? round4(packHits / expectedPacks.length) : 1,
      fact_recall: expectedFacts.length > 0 ? round4(factHits / expectedFacts.length) : 1,
      budget_overflow: overflow,
    });
  }

  const regressions = results.filter((result) => result.pack_recall < 1 || result.fact_recall < 1).length;
  const meanLoaded = mean(results.map((result) => result.loaded_tokens));
  return {
    tasks: results,
    mean_tokens_saved_pct: round4(mean(results.map((result) => result.tokens_saved_pct))),
    mean_pack_recall: round4(mean(results.map((result) => result.pack_recall))),
    mean_fact_recall: round4(mean(results.map((result) => result.fact_recall))),
    recall_regressions: regressions,
    corpus_baseline_pct: corpusTokens > 0 ? round4(meanLoaded / corpusTokens) : 0,
  };
}

async function corpusBaselineTokens(repo: string, counter: TokenCounter): Promise<number> {
  // Denominator must match the per-task baseline shape: the full (deduplicated) raw
  // load of each pack, including sources and linked ADRs. corpus_baseline_pct is then
  // the mean per-task budgeted load as a fraction of loading the whole corpus at full detail.
  const { features } = await readContextSnapshot(repo);
  let total = 0;
  for (const feature of features) {
    const loaded = await loadContext({ repo, route: feature.slug });
    total += counter.count(JSON.stringify({ feature: loaded.feature, facts: loaded.facts, sources: loaded.sources, adrs: loaded.adrs }, null, 2));
  }
  return total;
}

interface HandoffRecord {
  summary?: string;
  files?: string[];
}

export async function seedBenchmarkTasks({ repo }: { repo: string }): Promise<{ candidates: BenchmarkTask[]; skipped: number }> {
  const featurePaths = await buildFeaturePaths(repo);
  const handoffs = await readHandoffs(repo);
  const existing = new Set((await readBenchmarkTasks(repo)).tasks.map((task) => normalize(task.task)));

  const candidates: BenchmarkTask[] = [];
  const seenTasks = new Set<string>(existing);
  let skipped = 0;
  let index = 0;

  for (const handoff of handoffs) {
    const summary = (handoff.summary ?? "").trim();
    if (summary.length === 0) continue;
    const key = normalize(summary);
    if (seenTasks.has(key)) continue;

    const packs = inferPacks(handoff.files ?? [], featurePaths);
    if (packs.length === 0) {
      skipped++;
      continue;
    }
    seenTasks.add(key);
    candidates.push({ id: `SEED-${String(++index).padStart(3, "0")}`, task: summary, expect_packs: packs });
  }
  return { candidates, skipped };
}

export async function writeSeededTasks({ repo, candidates }: { repo: string; candidates: BenchmarkTask[] }): Promise<{ written: number; path: string }> {
  const relativePath = "docs/context/benchmarks/tasks.jsonl";
  const path = repoPath(repo, relativePath);
  const existing = (await readBenchmarkTasks(repo)).tasks;
  const seen = new Set(existing.map((task) => normalize(task.task)));
  const fresh = candidates.filter((task) => !seen.has(normalize(task.task)));
  if (fresh.length === 0) return { written: 0, path: relativePath };
  const prior = await readTextIfExists(path);
  const prefix = prior.length > 0 && !prior.endsWith("\n") ? `${prior}\n` : prior;
  const appended = fresh.map((task) => JSON.stringify(task)).join("\n") + "\n";
  await writeText(path, prefix + appended);
  return { written: fresh.length, path: relativePath };
}

async function buildFeaturePaths(repo: string): Promise<Map<string, Set<string>>> {
  const { features } = await readContextSnapshot(repo);
  const map = new Map<string, Set<string>>();
  for (const feature of features) {
    const paths = new Set<string>();
    const idmap = await readIdmapTokens(join(feature.dir, "IDMAP.md"));
    for (const value of idmap.values()) paths.add(normalizePath(value));
    map.set(feature.slug, paths);
  }
  return map;
}

function inferPacks(files: string[], featurePaths: Map<string, Set<string>>): string[] {
  const slugs = new Set<string>();
  for (const file of files) {
    const norm = normalizePath(file);
    for (const [slug, paths] of featurePaths) {
      if (paths.has(norm)) slugs.add(slug);
      if (norm.startsWith(`docs/context/features/${slug}/`)) slugs.add(slug);
    }
  }
  return [...slugs].sort();
}

async function readHandoffs(repo: string): Promise<HandoffRecord[]> {
  const text = await readTextIfExists(repoPath(repo, ".context-state/handoffs/handoffs.jsonl"));
  const records: HandoffRecord[] = [];
  for (const row of text.split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    try {
      records.push(JSON.parse(row) as HandoffRecord);
    } catch {
      // skip malformed handoff rows
    }
  }
  return records;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
