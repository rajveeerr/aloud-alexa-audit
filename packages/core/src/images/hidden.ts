import type { ClaimMatch, Grade, HiddenAnswer, ImageClaim, Intent } from "../types";

/**
 * A hidden answer needs two independent signals to agree:
 * 1. the verified text grade for the question is missing or partial, and
 * 2. an image claim answers that question and isn't covered by the text.
 * Ordered by how many shoppers ask, so the first one is the fix worth making first.
 */
export function findHiddenAnswers(grades: Grade[], claims: ImageClaim[], matches: ClaimMatch[], intents: Intent[]): HiddenAnswer[] {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const freq = new Map(intents.map((i) => [i.id, i.frequency]));
  const out: HiddenAnswer[] = [];

  for (const g of grades) {
    if (g.status !== "missing" && g.status !== "partial") continue;
    const found = matches
      .filter((m) => m.intentId === g.intentId && m.coverage !== "in_text")
      .flatMap((m) => claimById.get(m.claimId) ?? []);
    if (found.length > 0) out.push({ intentId: g.intentId, textStatus: g.status, claims: found });
  }
  return out.sort((a, b) => (freq.get(b.intentId) ?? 0) - (freq.get(a.intentId) ?? 0));
}
