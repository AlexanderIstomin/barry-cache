import type { AdrRecord } from "./adr";
import type { TokenCounter } from "./tokens";
import type { FactRecord, LoadedFeature } from "./types";

// Default per-pack budget. Selection fits the full emitted output within this budget,
// so it trades recall for savings: `bench run` on Barry's own packs shows ~94% fact
// recall here and full recall around 2000 — tune per repo. See ADR-0015.
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
  unknown_expand: string[];
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

  // Forced (expanded) ids are always kept; record which ones actually matched so the
  // CLI can warn about typos (unknown ids that selected nothing).
  const forcedFactIds = new Set(facts.filter((f) => expand.has(f.id)).map((f) => f.id));
  const forcedAdrIds = new Set(adrs.filter((a) => expand.has(a.id)).map((a) => a.id));
  const unknownExpand = [...expand].filter((id) => id !== "all" && !forcedFactIds.has(id) && !forcedAdrIds.has(id));

  // Forced facts first, then ranked candidates (high → low priority).
  const ranked = facts
    .filter((f) => !forcedFactIds.has(f.id) && f.status !== "superseded" && f.status !== "deprecated")
    .map((f) => ({ f, rel: relevance(factText(f), taskTokens) }))
    .sort((a, b) =>
      b.rel - a.rel ||
      KIND_WEIGHT[b.f.kind] - KIND_WEIGHT[a.f.kind] ||
      confidenceWeight(b.f) - confidenceWeight(a.f) ||
      cmpDateDesc(a.f.updated_at, b.f.updated_at) ||
      a.f.id.localeCompare(b.f.id))
    .map((entry) => entry.f);

  const forcedCount = forcedFactIds.size;
  const includedFacts: FactRecord[] = [...facts.filter((f) => forcedFactIds.has(f.id)), ...ranked];

  // ADRs: forced → full body; the rest → title + summary, trimmable.
  const adrViews: BudgetedAdr[] = [
    ...adrs.filter((a) => forcedAdrIds.has(a.id)).map((a) => ({ id: a.id, title: a.title, summary: a.content })),
    ...adrs.filter((a) => !forcedAdrIds.has(a.id)).map((a) => ({ id: a.id, title: a.title, summary: firstParagraph(a.content) })),
  ];
  const forcedAdrCount = forcedAdrIds.size;

  // Baseline mirrors the exact (deduplicated) raw `load` output shape.
  const baseline = cost({ feature, facts, sources, adrs });
  const dropped: string[] = [];
  const expand_hint = `barry-cache load --route ${feature.slug} --budget ${budget} --expand <ID> (or --expand all for the full pack)`;

  // `used` is the cost of the WHOLE emitted object (content + sources + this report).
  // Start with everything selectable, then trim the lowest-ranked item until the full
  // emitted output fits the budget. Forced --expand items and the core summary are
  // never trimmed, so they (and only they) can push `used` past the budget.
  const measure = (): number => cost({
    feature: core, facts: includedFacts, adrs: adrViews, sources,
    budget: { budget, used: 0, baseline_tokens: baseline, saved_pct: 0, overflow: 0, dropped, unknown_expand: unknownExpand, expand_hint },
  });
  while (measure() > budget) {
    if (includedFacts.length > forcedCount) {
      dropped.push(includedFacts.pop()!.id); // lowest-ranked fact
    } else if (adrViews.length > forcedAdrCount) {
      dropped.push(adrViews.pop()!.id); // lowest-priority ADR summary
    } else {
      break; // only forced items + core remain — allowed to overflow
    }
  }

  const used = measure();
  return {
    feature: core,
    facts: includedFacts,
    adrs: adrViews,
    sources,
    budget: {
      budget,
      used,
      baseline_tokens: baseline,
      saved_pct: baseline > 0 ? Math.max(0, round4(1 - used / baseline)) : 0,
      overflow: Math.max(0, used - budget),
      dropped,
      unknown_expand: unknownExpand,
      expand_hint,
    },
  };
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
