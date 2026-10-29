#!/usr/bin/env bun
/**
 * bun study/analyze.ts
 *
 * Reads study/sample.json and study/scores.json and writes study/results.json and
 * study/RESULTS.md. Pure arithmetic, no model calls, same output every run.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IntentSet } from "@answerable/core";
import { ROOT, STUDY, type Sample, type Scores } from "./lib";
import { estimate, mean, median, partialStat, spearmanStat, type Estimate } from "./stats";

const sample = JSON.parse(await readFile(join(STUDY, "sample.json"), "utf8")) as Sample;
const scores = JSON.parse(await readFile(join(STUDY, "scores.json"), "utf8")) as Scores;
const intentSet = JSON.parse(await readFile(join(ROOT, "fixtures/intents/gel-ink-pens.json"), "utf8")) as IntentSet;

const meta = new Map(sample.products.map((p) => [p.asin, p]));
const rows = scores.products
  .filter((s) => s.score !== null)
  .map((s) => ({ ...s, score: s.score!, product: meta.get(s.asin)! }));
const noScore = scores.products.length - rows.length;

const score = (r: typeof rows) => r.map((x) => x.score);
const logReviews = (r: typeof rows) => r.map((x) => Math.log10(x.product.rating_number));

const overall = estimate(spearmanStat, [score(rows), logReviews(rows)], 1);

const priced = rows.filter((r) => r.product.price !== null);
const partial = estimate(partialStat, [score(priced), logReviews(priced), priced.map((r) => r.product.price!)], 2);
const plainPriced = estimate(spearmanStat, [score(priced), logReviews(priced)], 3);
const priceVsScore = estimate(spearmanStat, [score(priced), priced.map((r) => r.product.price!)], 4);

// Lower rank means more sales, so flip the sign: a positive rho means better-ranked pens score higher.
const ranked = rows.filter((r) => r.product.salesRank !== null);
const salesRank = estimate(spearmanStat, [score(ranked), ranked.map((r) => -Math.log10(r.product.salesRank!))], 5);

const bands = [1, 2, 3, 4].map((band) => {
  const b = rows.filter((r) => r.band === band);
  const ns = b.map((r) => r.product.rating_number);
  return {
    band,
    n: b.length,
    reviews: [Math.min(...ns), Math.max(...ns)] as [number, number],
    meanScore: round(mean(score(b)), 1),
    medianScore: median(score(b)),
    meanAnswered: round(mean(b.map((r) => r.answered)), 1),
    meanCounted: round(mean(b.map((r) => r.counted)), 1),
    correlation: b.length >= 10 ? rounded(estimate(spearmanStat, [score(b), logReviews(b)], 10 + band)) : null,
  };
});

// How often each counted question goes unanswered (missing or contradicted) in the lowest and
// highest demand bands, among products where the question applies.
const countedIntents = intentSet.intents.filter((i) => i.kind !== "experience");
const unanswered = (band: number, id: string) => {
  const graded = rows.filter((r) => r.band === band && r.statuses[id] && r.statuses[id] !== "not_applicable");
  const gap = graded.filter((r) => r.statuses[id] === "missing" || r.statuses[id] === "contradicted").length;
  return { n: graded.length, rate: graded.length ? round(gap / graded.length, 2) : null };
};
const questions = countedIntents
  .map((i) => {
    const low = unanswered(1, i.id);
    const high = unanswered(4, i.id);
    return { id: i.id, question: i.question, kind: i.kind, frequency: i.frequency, low, high };
  })
  .sort((a, b) => (b.high.rate ?? -1) - (a.high.rate ?? -1) || b.frequency - a.frequency);

const results = {
  generatedFrom: { graded: rows.length, sampled: sample.products.length, pending: scores.pending.length, noScore, model: scores.model, intentSetVersion: scores.intentSetVersion },
  method: {
    correlation: "Spearman rank correlation, ties averaged",
    ci: "95% percentile bootstrap, 2,000 resamples of products, seeded",
    p: "two-sided permutation test, 10,000 shuffles of review count, seeded",
    partial: "partial Spearman: Pearson partial correlation on ranks, controlling for price",
  },
  scoreVsReviews: rounded(overall),
  scoreVsReviewsControllingPrice: { ...rounded(partial), plainOnSameProducts: rounded(plainPriced), scoreVsPrice: rounded(priceVsScore) },
  scoreVsSalesRank: rounded(salesRank),
  bands,
  questions,
};
await writeFile(join(STUDY, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(STUDY, "RESULTS.md"), markdown());
console.log(`rho ${f(overall.rho)} [${f(overall.ci[0])}, ${f(overall.ci[1])}], p ${p(overall.p)}, n ${overall.n}`);
console.log(`partial (price) rho ${f(partial.rho)} [${f(partial.ci[0])}, ${f(partial.ci[1])}], p ${p(partial.p)}, n ${partial.n}`);
console.log("wrote study/results.json and study/RESULTS.md");

function round(x: number, d: number): number {
  return Number(x.toFixed(d));
}
function rounded(e: Estimate): Estimate {
  return { n: e.n, rho: round(e.rho, 3), ci: [round(e.ci[0], 3), round(e.ci[1], 3)], p: round(e.p, 4) };
}
function f(x: number): string {
  return x.toFixed(2);
}
function p(x: number): string {
  return x < 0.001 ? "< 0.001" : x.toFixed(3);
}
function significant(e: Estimate): boolean {
  return e.p < 0.05 && (e.ci[0] > 0 || e.ci[1] < 0);
}
function strength(rho: number): string {
  const a = Math.abs(rho);
  return a < 0.1 ? "negligible" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong";
}
function line(e: Estimate): string {
  return `rho ${f(e.rho)} (95% CI ${f(e.ci[0])} to ${f(e.ci[1])}), p ${p(e.p)}, n ${e.n}`;
}
function pct(x: number | null): string {
  return x === null ? "n/a" : `${Math.round(x * 100)}%`;
}

function reading(): string {
  const dir = overall.rho > 0 ? "higher" : "lower";
  const sig = significant(overall);
  const head = sig
    ? `Across ${overall.n} gel pens, listings that answer more of the shoppers' questions tend to have ${dir} review counts: a ${strength(overall.rho)} rank correlation (${line(overall)}).`
    : `Across ${overall.n} gel pens, the answerability score has no clear relation to review count (${line(overall)}). On this data the score is not predictive of demand.`;
  const partialText = significant(partial)
    ? `Holding price fixed changes little: on the ${partial.n} pens with a price, the partial correlation is ${f(partial.rho)} (CI ${f(partial.ci[0])} to ${f(partial.ci[1])}, p ${p(partial.p)}).`
    : `Holding price fixed, on the ${partial.n} pens with a price, the partial correlation is ${f(partial.rho)} (CI ${f(partial.ci[0])} to ${f(partial.ci[1])}, p ${p(partial.p)}), which is not distinguishable from zero.`;
  const weakNote =
    sig && Math.abs(overall.rho) < 0.3
      ? " Even where it is significant, a correlation this size explains only a few percent of the variation in rank, so the score cannot predict how well any single listing sells."
      : "";
  return [
    head,
    partialText + weakNote,
    "This is correlation, not cause: a brand that writes complete listings may also advertise more, have better distribution or simply be older, and popular products may get their listings improved because they sell, not the other way round.",
    "The data is the Amazon Reviews 2023 snapshot, so the listings and counts are from 2023, not today.",
    "It measures the listing's readable text (title, bullets, description, attributes), not what Alexa for Shopping actually says, and it ignores images and A+ content.",
    "Review count is only a proxy for sales; it also grows with time on the market.",
  ].join(" ");
}

function markdown(): string {
  const bandRows = bands.map(
    (b) =>
      `| ${b.band} | ${b.reviews[0].toLocaleString("en-US")}-${b.reviews[1].toLocaleString("en-US")} | ${b.n} | ${b.meanScore} | ${b.medianScore} | ${b.meanAnswered} of ${b.meanCounted} | ${b.correlation ? `${f(b.correlation.rho)} (${f(b.correlation.ci[0])} to ${f(b.correlation.ci[1])}), p ${p(b.correlation.p)}` : "n/a"} |`,
  );
  const qRows = questions.map((q) => `| ${q.question} | ${q.kind} | ${pct(q.low.rate)} (${q.low.n}) | ${pct(q.high.rate)} (${q.high.n}) |`);
  const status =
    rows.length + noScore === sample.products.length
      ? `All ${sample.products.length} sampled products were graded.`
      : `**Only ${scores.products.length} of ${sample.products.length} sampled products are graded so far** (${scores.pending.length} pending, waiting on the free-tier quota). The numbers below cover the graded ones.`;

  return `# Validation study: does answerability track demand?

${status}${noScore ? ` ${noScore} had no countable question and are left out.` : ""}

![Score vs review count](chart.svg)

${reading()}

## Setup

- ${sample.products.length} gel pens from Amazon Reviews 2023 (Gel Ink Rollerball Pens), drawn from ${sample.pool.toLocaleString("en-US")} with at least 3 bullets and at least 20 ratings.
- The ${sample.excludedMiningProducts} products whose reviews were mined for the question set are left out, so no product is graded against questions taken from its own reviews.
- 50 per demand band (quartiles of log10 review count), picked in seeded hash order (\`study/select.ts\`).
- Each listing's text graded once against the reviewed gel-pen question set (${scores.intentSetVersion}) with ${scores.model}, one request per product, no images and no briefs. Recordings are in \`study/llm-cache/\`, so \`bun study\` replays everything offline.
- Score: the product's answerability score, 0-100, over spec and claim questions.
- Spearman correlation; 95% CI from 2,000 bootstrap resamples; p from 10,000 permutations. Both seeded.

## Numbers

| test | result |
|---|---|
| score vs log review count, all graded | ${line(overall)} |
| same, price held fixed (partial Spearman) | ${line(partial)} |
| same products, price not held fixed | ${line(plainPriced)} |
| score vs price | ${line(priceVsScore)} |
| score vs 2023 Office Products sales rank (sign flipped, so positive = sells better) | ${line(salesRank)} |

The sales-rank row uses the Best Sellers Rank stored in the dataset records (${salesRank.n} of the graded products have one). It's a single 2023 snapshot, so treat it as a second proxy, not ground truth.

## By demand band

| band | reviews | n | mean score | median | answered | rho within band |
|---|---|---:|---:|---:|---|---|
${bandRows.join("\n")}

## Which questions go unanswered

Share of listings where the question is missing or contradicted, in the lowest band (1) and the highest (4), among listings where it applies (count in brackets).

| question | kind | band 1 | band 4 |
|---|---|---:|---:|
${qRows.join("\n")}

## Future work

- Live sales-rank sub-sample: about 50 current listings through SerpApi, checked against today's Best Sellers Rank instead of 2023 review counts. Not done here.
- Repeat in a second category to see whether the pattern holds outside gel pens.
`;
}
