/** Wording for promise vs proof. No React or path aliases, so it's unit tested with bun test. */
type Counts = { supports: number; contradicts: number; mixed: number };
type ClaimCounts = { matching: number; sampled: number; counts: Counts };

/** Reviews that actually discuss the claim: the base every rate is a share of. */
export const discussing = (c: { counts: Counts }) => c.counts.supports + c.counts.contradicts + c.counts.mixed;

const reviews = (n: number) => `${n} review${n === 1 ? "" : "s"}`;

/**
 * Why there's no verdict. Few reviews may use the claim's words at all, or many may use them
 * while few actually discuss the claim (the rest were labelled unrelated): say which.
 */
export function tooFew(c: ClaimCounts): string {
  const total = discussing(c);
  const mention = `${reviews(c.matching)} ${c.matching === 1 ? "mentions" : "mention"} the words`;
  if (total < c.sampled) {
    const of = c.sampled < c.matching ? ` (of ${c.sampled} sampled)` : "";
    return `${mention}, but only ${total}${of} ${total === 1 ? "discusses" : "discuss"} the claim, too few to judge.`;
  }
  return `Only ${mention}, too few to judge.`;
}
