import type { AdrRecord } from "./adr";
import type { TokenCounter } from "./tokens";
import type { FactRecord, LoadedFeature } from "./types";

// Recommended default per-pack budget — the knee of the recall/savings curve on
// Barry's own context (full fact recall, ~0 regressions). See ADR-0015.
export const DEFAULT_LOAD_BUDGET = 1500;

const KIND_WEIGHT: Record<FactRecord["kind"], number> = {
  decision: 5, constraint: 5, risk: 4, implemented: 3, test: 2, "open-question": 2,
};
const CONFIDENCE_WEIGHT: Record<NonNullable<FactRecord["confidence"]>, number> = {
  high: 3, medium: 2, low: 1,
};

export interface BudgetedAdr {
  id: string;
  title: string;
  summary: string;
}

export interface BudgetReport {
  budget: number;
  // Tokens of the entire emitted BudgetedContext (core + facts + ADRs + sources +
  // this report), so it reflects what print() actually outputs — not just content.
  used: number;
  baseline_tokens: number;
  saved_pct: number;
  overflow: number;
  dropped: string[];
  expand_hint: string;
}

export interface BudgetedContext {
  feature: { slug: string; title: string; summary: string };
  facts: FactRecord[];
  adrs: BudgetedAdr[];
  sources: string[];
  budget: BudgetReport;
}

export interface BudgetInput {
  feature: LoadedFeature;
  facts: FactRecord[];
  adrs: AdrRecord[];
  sources: string[];
  task: string;
  budget: number;
  counter: TokenCounter;
  expand?: string[];
}

export function budgetContext(input: BudgetInput): BudgetedContext {
  const { feature, facts, adrs, sources, budget, counter } = input;
  const expand = new Set(input.expand ?? []);
  const taskTokens = tokenize(input.task);
  // Measure exactly what print() would emit (2-space pretty JSON), so reported tokens match output.
  const cost = (value: unknown): number => counter.count(JSON.stringify(value, null, 2));

  const core = {
    slug: feature.slug,
    title: firstHeading(feature.readme) || feature.slug,
    summary: firstParagraph(feature.readme),
  };
  // `selected` is the running content tally that drives inclusion decisions. The
  // reported `used` (below) is the cost of the whole emitted object.
  let selected = cost(core) + cost(sources);

  const includedFacts: FactRecord[] = [];
  const dropped: string[] = [];

  // Forced (expanded) facts first — always included, even past budget.
  for (const f of facts) {
    if (expand.has(f.id)) {
      includedFacts.push(f);
      selected += cost(f);
    }
  }

  // Rank the rest; superseded/deprecated are excluded from default selection.
  const ranked = facts
    .filter((f) => !expand.has(f.id) && f.status !== "superseded" && f.status !== "deprecated")
    .map((f) => ({ f, rel: relevance(factText(f), taskTokens) }))
    .sort((a, b) =>
      b.rel - a.rel ||
      KIND_WEIGHT[b.f.kind] - KIND_WEIGHT[a.f.kind] ||
      confidenceWeight(b.f) - confidenceWeight(a.f) ||
      cmpDateDesc(a.f.updated_at, b.f.updated_at) ||
      a.f.id.localeCompare(b.f.id))
    .map((entry) => entry.f);

  for (const f of ranked) {
    const c = cost(f);
    if (selected + c <= budget) {
      includedFacts.push(f);
      selected += c;
    } else {
      dropped.push(f.id);
    }
  }

  // ADRs: title + summary by default; full body only when expanded.
  const adrViews: BudgetedAdr[] = [];
  for (const adr of adrs) {
    if (expand.has(adr.id)) {
      const full: BudgetedAdr = { id: adr.id, title: adr.title, summary: adr.content };
      adrViews.push(full);
      selected += cost(full);
      continue;
    }
    const view: BudgetedAdr = { id: adr.id, title: adr.title, summary: firstParagraph(adr.content) };
    const c = cost(view);
    if (selected + c <= budget) {
      adrViews.push(view);
      selected += c;
    } else {
      dropped.push(adr.id);
    }
  }

  // Baseline mirrors the exact (deduplicated) raw `load` output shape.
  const baseline = cost({ feature, facts, sources, adrs });

  const report: BudgetReport = {
    budget,
    used: 0,
    baseline_tokens: baseline,
    saved_pct: 0,
    overflow: 0,
    dropped,
    expand_hint: `barry-cache load --route ${feature.slug} --budget ${budget} --expand <ID> (or --expand all for the full pack)`,
  };
  const result: BudgetedContext = { feature: core, facts: includedFacts, adrs: adrViews, sources, budget: report };
  // `used` = the true cost of everything emitted (including sources and this report).
  const used = cost(result);
  report.used = used;
  report.overflow = Math.max(0, used - budget);
  report.saved_pct = baseline > 0 ? round4(1 - used / baseline) : 0;
  return result;
}

function confidenceWeight(fact: FactRecord): number {
  return fact.confidence ? CONFIDENCE_WEIGHT[fact.confidence] : 0;
}

function factText(fact: FactRecord): string {
  return [fact.id, fact.subject, fact.predicate, fact.object, fact.status, fact.kind, ...fact.src, ...(fact.tags ?? [])].join(" ");
}

function tokenize(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

function relevance(text: string, taskTokens: string[]): number {
  const haystack = text.toLowerCase();
  return taskTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function firstHeading(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.*)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function firstParagraph(markdown: string): string {
  const collected: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.length === 0) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(trimmed);
  }
  return collected.join(" ");
}

function cmpDateDesc(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
