export function tokens(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

export function scoreText(text: string, queryTokens: string[]): number {
  // tokens() lowercases query terms, so normalize the haystack too; otherwise
  // a non-lowercased caller would silently miss mixed-case matches.
  const haystack = text.toLowerCase();
  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}
