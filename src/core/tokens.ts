export interface TokenCounter {
  count(text: string): number;
}

// Approximate by design: ~4 chars per token. Budgets are coarse guidance.
export const heuristicCounter: TokenCounter = {
  count(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / 4);
  },
};

// Seam for a real BPE tokenizer later (e.g. getCounter("gpt")) without touching callers.
export function getCounter(name?: string): TokenCounter {
  if (name === undefined || name === "heuristic") return heuristicCounter;
  throw new Error(`unknown token counter: ${name}`);
}
