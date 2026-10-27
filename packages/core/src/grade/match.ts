/**
 * Does a quote appear in a field? Exact after normalising case, whitespace, quotes and dashes.
 * If not exact, a tight fuzzy match allows a few typo-level edits (the model sometimes drops
 * a comma or splits "0.5mm" into "0.5 mm"), but never a different sentence.
 */

/** Same normalisation for both sides, so only real differences count. */
export function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC`\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edits allowed: 1 per 25 characters of quote, and none for quotes shorter than 12. */
export function allowedEdits(quoteLength: number): number {
  return quoteLength < 12 ? 0 : Math.floor(quoteLength / 25);
}

/**
 * Smallest edit distance between `needle` and any substring of `haystack`
 * (Sellers' algorithm: the match may start and end anywhere in the haystack).
 * O(needle × haystack), which is small for listing fields.
 */
export function bestSubstringDistance(needle: string, haystack: string): number {
  const n = needle.length;
  let prev = new Array<number>(n + 1);
  for (let i = 0; i <= n; i++) prev[i] = i;
  let best = prev[n]!;

  for (let j = 1; j <= haystack.length; j++) {
    const cur = new Array<number>(n + 1);
    cur[0] = 0; // a match may start at any position in the haystack
    for (let i = 1; i <= n; i++) {
      const cost = needle[i - 1] === haystack[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + cost);
    }
    best = Math.min(best, cur[n]!);
    prev = cur;
  }
  return best;
}

export function quoteMatches(quote: string, field: string): boolean {
  const q = normaliseForMatch(quote);
  const f = normaliseForMatch(field);
  if (q.length < 3) return false;
  if (f.includes(q)) return true;
  const allowed = allowedEdits(q.length);
  return allowed > 0 && bestSubstringDistance(q, f) <= allowed;
}
