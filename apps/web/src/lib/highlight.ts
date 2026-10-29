export type Span = { text: string; mark: "strong" | "soft" | null };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a quote sits in a field, ignoring case and runs of whitespace (the verifier normalises the same way). */
function locate(text: string, quote: string): [number, number] | null {
  const q = quote.trim();
  if (!q) return null;
  const re = new RegExp(escape(q).replace(/\s+/g, "\\s+"), "i");
  const m = re.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

/**
 * Splits field text into spans so verified quotes can be marked in place.
 * Strong quotes (the selected question) win over soft ones where they overlap.
 */
export function highlight(text: string, strong: string[], soft: string[] = []): Span[] {
  const level = new Array<0 | 1 | 2>(text.length).fill(0);
  for (const [quotes, l] of [
    [soft, 1],
    [strong, 2],
  ] as const) {
    for (const q of quotes) {
      const at = locate(text, q);
      if (!at) continue;
      for (let i = at[0]; i < at[1]; i++) level[i] = Math.max(level[i]!, l) as 0 | 1 | 2;
    }
  }
  const spans: Span[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || level[i] !== level[start]) {
      const l = level[start];
      spans.push({ text: text.slice(start, i), mark: l === 2 ? "strong" : l === 1 ? "soft" : null });
      start = i;
    }
  }
  return spans;
}
