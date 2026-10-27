import type { Grade, Intent } from "./types";

export type Score = {
  /** 0-100, or null when no question applies. */
  score: number | null;
  answered: number;
  partial: number;
  missing: number;
  contradicted: number;
  /** Questions that count: spec and claim, minus ones that don't apply to this product. */
  counted: number;
  notApplicable: number;
};

const WEIGHT = { answered: 1, partial: 0.5, missing: 0, contradicted: 0 } as const;

/**
 * score = 100 × Σ(frequency × weight) / Σ(frequency), over spec and claim questions only.
 * Experience questions never count: no listing can prove how a pen feels.
 * A contradiction scores 0, the same as missing: a shopper can't trust either answer.
 * Always report the counts with the number ("answers 9 of 17"), never the number alone.
 */
export function scoreGrades(grades: Grade[], intents: Intent[]): Score {
  const byId = new Map(intents.map((i) => [i.id, i]));
  const out: Score = { score: null, answered: 0, partial: 0, missing: 0, contradicted: 0, counted: 0, notApplicable: 0 };
  let earned = 0;
  let possible = 0;

  for (const g of grades) {
    const intent = byId.get(g.intentId);
    if (!intent || intent.kind === "experience") continue;
    if (g.status === "not_applicable") {
      out.notApplicable++;
      continue;
    }
    out.counted++;
    out[g.status]++;
    earned += intent.frequency * WEIGHT[g.status];
    possible += intent.frequency;
  }

  out.score = possible > 0 ? Math.round((100 * earned) / possible) : null;
  return out;
}
