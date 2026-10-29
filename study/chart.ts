#!/usr/bin/env bun
/**
 * bun study/chart.ts
 *
 * Draws study/chart.svg: answerability score (x) against log10 review count (y), one dot per
 * product, with a trend line through the median review count of each fifth of products ranked by
 * score. Run after analyze.ts; the caption reads its numbers from results.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STUDY, type Sample, type Scores } from "./lib";
import { median } from "./stats";
import type { Estimate } from "./stats";

const sample = JSON.parse(await readFile(join(STUDY, "sample.json"), "utf8")) as Sample;
const scores = JSON.parse(await readFile(join(STUDY, "scores.json"), "utf8")) as Scores;
const results = JSON.parse(await readFile(join(STUDY, "results.json"), "utf8")) as { scoreVsReviews: Estimate };

const reviews = new Map(sample.products.map((p) => [p.asin, p]));
const points = scores.products
  .filter((s) => s.score !== null)
  .map((s) => {
    const p = reviews.get(s.asin)!;
    return { x: s.score!, y: Math.log10(p.rating_number), n: p.rating_number, title: p.title, asin: s.asin };
  });

const ORANGE = "#FF8800";
const INK = "#1f2328";
const MUTED = "#6b7280";
const GRID = "#e5e7eb";
const TREND = "#374151";
const SURFACE = "#ffffff";

const W = 720;
const H = 480;
const M = { top: 64, right: 28, bottom: 92, left: 72 };
const pw = W - M.left - M.right;
const ph = H - M.top - M.bottom;

const yMin = Math.floor(Math.min(...points.map((p) => p.y)) * 2) / 2;
const yMax = Math.ceil(Math.max(...points.map((p) => p.y)) * 2) / 2;
const sx = (x: number) => M.left + (x / 100) * pw;
const sy = (y: number) => M.top + ph - ((y - yMin) / (yMax - yMin)) * ph;

// Trend: split products into five equal groups by score rank, then join the group medians.
const byScore = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
const groups = 5;
const trend = Array.from({ length: groups }, (_, g) => {
  const part = byScore.slice(Math.floor((g * byScore.length) / groups), Math.floor(((g + 1) * byScore.length) / groups));
  return { x: median(part.map((p) => p.x)), y: median(part.map((p) => p.y)) };
}).filter((t) => Number.isFinite(t.x));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (x: number) => x.toFixed(2);
const r = results.scoreVsReviews;

const xTicks = [0, 20, 40, 60, 80, 100];
const yTicks: number[] = [];
for (let v = Math.ceil(yMin); v <= yMax; v++) yTicks.push(v);
const count = (v: number) => (10 ** v).toLocaleString("en-US");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-labelledby="t d">
  <title id="t">Answerability score against review count, ${points.length} gel pens</title>
  <desc id="d">Each dot is one gel pen. Spearman rho ${fmt(r.rho)}, 95% CI ${fmt(r.ci[0])} to ${fmt(r.ci[1])}, permutation p ${r.p < 0.001 ? "below 0.001" : r.p.toFixed(3)}.</desc>
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="${M.left}" y="30" font-size="17" font-weight="600" fill="${INK}">Do pens with more complete listings have more reviews?</text>
  <text x="${M.left}" y="50" font-size="13" fill="${MUTED}">${points.length} gel pens, Amazon Reviews 2023. Score: share of shopper questions the listing text answers.</text>
  <g stroke="${GRID}" stroke-width="1">
${yTicks.map((v) => `    <line x1="${M.left}" x2="${M.left + pw}" y1="${sy(v)}" y2="${sy(v)}"/>`).join("\n")}
${xTicks.map((v) => `    <line x1="${sx(v)}" x2="${sx(v)}" y1="${M.top}" y2="${M.top + ph}"/>`).join("\n")}
  </g>
  <g font-size="12" fill="${MUTED}">
${yTicks.map((v) => `    <text x="${M.left - 10}" y="${sy(v) + 4}" text-anchor="end">${count(v)}</text>`).join("\n")}
${xTicks.map((v) => `    <text x="${sx(v)}" y="${M.top + ph + 20}" text-anchor="middle">${v}</text>`).join("\n")}
  </g>
  <text x="${M.left + pw / 2}" y="${M.top + ph + 44}" font-size="13" fill="${INK}" text-anchor="middle">Answerability score (0-100)</text>
  <text transform="translate(20 ${M.top + ph / 2}) rotate(-90)" font-size="13" fill="${INK}" text-anchor="middle">Review count (log scale)</text>
  <g fill="${ORANGE}" fill-opacity="0.75" stroke="${SURFACE}" stroke-width="2">
${points.map((p) => `    <circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="5"><title>${esc(p.title.slice(0, 80))} (${p.asin}): score ${p.x}, ${p.n.toLocaleString("en-US")} reviews</title></circle>`).join("\n")}
  </g>
  <polyline fill="none" stroke="${TREND}" stroke-width="2" stroke-linejoin="round" points="${trend.map((t) => `${sx(t.x).toFixed(1)},${sy(t.y).toFixed(1)}`).join(" ")}"/>
  <g fill="${TREND}" stroke="${SURFACE}" stroke-width="2">
${trend.map((t) => `    <circle cx="${sx(t.x).toFixed(1)}" cy="${sy(t.y).toFixed(1)}" r="4"/>`).join("\n")}
  </g>
  <text x="${M.left}" y="${H - 22}" font-size="12" fill="${MUTED}">Line: median review count in each fifth of pens ranked by score. Spearman rho ${fmt(r.rho)} (95% CI ${fmt(r.ci[0])} to ${fmt(r.ci[1])}),</text>
  <text x="${M.left}" y="${H - 6}" font-size="12" fill="${MUTED}">p ${r.p < 0.001 ? "< 0.001" : r.p.toFixed(3)}, n ${r.n}. Correlation, not cause; review count is a proxy for sales.</text>
</svg>
`;

await writeFile(join(STUDY, "chart.svg"), svg);
console.log("wrote study/chart.svg");
