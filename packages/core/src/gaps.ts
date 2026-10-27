import type { Gap, Grade, HiddenAnswer, Intent, Listing } from "./types";

export type GradedListing = { listing: Listing; grades: Grade[] };

/** How much fixing each status gains: a partial answer is already half there. */
const GAIN = { missing: 1, partial: 0.5, contradicted: 1 } as const;

/**
 * Every spec or claim question the listing misses, half-answers or contradicts, ranked:
 *   priority = frequency × gain × (0.5 + 0.5 × competitorShare)
 * The 0.5 floor keeps a common question on the list even when no competitor answers it yet:
 * that's a chance to stand out, not a reason to ignore it. With no competitors, share counts as 0.
 */
export function computeGaps(target: GradedListing, competitors: GradedListing[], intents: Intent[], hidden: HiddenAnswer[] = []): Gap[] {
  const byId = new Map(intents.map((i) => [i.id, i]));
  const hiddenBy = new Map(hidden.map((h) => [h.intentId, h.claims]));
  const gaps: Gap[] = [];

  for (const g of target.grades) {
    const intent = byId.get(g.intentId);
    if (!intent || intent.kind === "experience") continue;
    if (g.status !== "missing" && g.status !== "partial" && g.status !== "contradicted") continue;

    let credit = 0;
    let counted = 0;
    const answering: Gap["competitorsAnswering"] = [];
    for (const c of competitors) {
      const cg = c.grades.find((x) => x.intentId === g.intentId);
      // A competitor the question doesn't apply to (e.g. scent on an unscented pen) isn't counted.
      if (!cg || cg.status === "not_applicable") continue;
      counted++;
      if (cg.status === "answered" || cg.status === "partial") {
        credit += cg.status === "answered" ? 1 : 0.5;
        const quote = cg.quotes[0];
        if (quote) answering.push({ asin: c.listing.asin, ...(c.listing.meta.brand && { brand: c.listing.meta.brand }), quote });
      }
    }
    const competitorShare = counted > 0 ? credit / counted : null;
    const priority = intent.frequency * GAIN[g.status] * (0.5 + 0.5 * (competitorShare ?? 0));

    gaps.push({
      intentId: g.intentId,
      status: g.status,
      frequency: intent.frequency,
      competitorShare,
      competitorsAnswering: answering,
      hiddenClaims: hiddenBy.get(g.intentId) ?? [],
      priority: Math.round(priority * 10) / 10,
    });
  }
  return gaps.sort((a, b) => b.priority - a.priority);
}
