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

/**
 * How many points the score would gain if each counted question were fully answered, holding
 * every other grade fixed. Used to show "+N points" next to a fix. The gains don't add up
 * exactly: each is rounded on its own, the same way the score is.
 */
export function pointsIfAnswered(grades: Grade[], intents: Intent[]): Map<string, number> {
  const byId = new Map(intents.map((i) => [i.id, i]));
  const counted = grades.flatMap((g) => {
    const intent = byId.get(g.intentId);
    if (!intent || intent.kind === "experience" || g.status === "not_applicable") return [];
    return [{ id: g.intentId, frequency: intent.frequency, weight: WEIGHT[g.status] }];
  });
  const possible = counted.reduce((n, c) => n + c.frequency, 0);
  const out = new Map<string, number>();
  if (possible === 0) return out;

  const earned = counted.reduce((n, c) => n + c.frequency * c.weight, 0);
  const now = Math.round((100 * earned) / possible);
  for (const c of counted) {
    const after = Math.round((100 * (earned + c.frequency * (1 - c.weight))) / possible);
    out.set(c.id, after - now);
  }
  return out;
}

export type ScoreBand = "ready" | "partly_ready" | "not_ready";

/**
 * A plain-words reading of the score. The cut-offs are a judgement call, not a measured
 * threshold: 80 means a shopper's question is answered four times in five, below 50 means
 * more often missed than answered. They describe the listing, not what Alexa will do.
 */
export function scoreBand(score: number | null): ScoreBand | null {
  if (score === null) return null;
  if (score >= 80) return "ready";
  if (score >= 50) return "partly_ready";
  return "not_ready";
}
