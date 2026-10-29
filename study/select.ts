#!/usr/bin/env bun
/**
 * bun study/select.ts [--data <dir>]
 *
 * Picks the 200 gel pens for the validation study from data/raw/gel_meta.jsonl and writes
 * study/sample.json, plus study/listings.jsonl (their raw dataset records) so the study can be
 * re-graded later without the dataset.
 *
 * - Leaves out the 60 products whose reviews were mined for the question set, picked the same way
 *   the miner did: most reviews of 120-900 characters, ties in file order.
 * - Keeps products with at least 3 bullets and at least 20 ratings.
 * - Splits the rest into 4 bands by log10(rating_number) quartiles and takes 50 from each, in
 *   seeded hash order.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir, jsonl, SEED, seededKey, STUDY, type Sample, type SampleRow } from "./lib";

const PER_BAND = 50;
const MINED_PRODUCTS = 60;

type Meta = {
  parent_asin: string;
  title?: string;
  features?: unknown[];
  rating_number?: number | null;
  average_rating?: number | null;
  price?: unknown;
  store?: string | null;
  details?: Record<string, unknown>;
};

const dir = dataDir(process.argv.slice(2));

// The miner counted reviews by Python len(), which counts code points, not UTF-16 units.
const minable = new Map<string, number>();
for await (const r of jsonl<{ a: string; x: string }>(join(dir, "gel_reviews.jsonl"))) {
  const len = Array.from(r.x).length;
  if (len >= 120 && len <= 900) minable.set(r.a, (minable.get(r.a) ?? 0) + 1);
}
// Array sort is stable, so ties keep first-seen order, as Python's sorted() does.
const mined = new Set(
  [...minable.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, MINED_PRODUCTS)
    .map(([a]) => a),
);

const pool: { row: Omit<SampleRow, "band">; raw: Meta; log: number }[] = [];
for await (const m of jsonl<Meta>(join(dir, "gel_meta.jsonl"))) {
  if (mined.has(m.parent_asin)) continue;
  const bullets = (m.features ?? []).filter((f) => typeof f === "string" && f.trim()).length;
  const n = m.rating_number ?? 0;
  if (bullets < 3 || n < 20) continue;
  const rank = (m.details?.["Best Sellers Rank"] as Record<string, unknown> | undefined)?.["Office Products"];
  pool.push({
    raw: m,
    log: Math.log10(n),
    row: {
      asin: m.parent_asin,
      rating_number: n,
      average_rating: m.average_rating ?? null,
      price: typeof m.price === "number" ? m.price : null,
      salesRank: typeof rank === "number" ? rank : null,
      store: m.store ?? null,
      title: m.title ?? "",
    },
  });
}

const sorted = pool.map((p) => p.log).sort((a, b) => a - b);
const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))]!;
const cuts = [at(0.25), at(0.5), at(0.75)];
const bandOf = (log: number) => 1 + cuts.filter((c) => log > c).length;

const chosen: { row: SampleRow; raw: Meta }[] = [];
for (let band = 1; band <= 4; band++) {
  const members = pool
    .filter((p) => bandOf(p.log) === band)
    .sort((a, b) => (seededKey(a.row.asin) < seededKey(b.row.asin) ? -1 : 1))
    .slice(0, PER_BAND);
  if (members.length < PER_BAND) throw new Error(`band ${band} has only ${members.length} products`);
  for (const m of members) chosen.push({ row: { ...m.row, band }, raw: m.raw });
}

const sample: Sample = {
  seed: SEED,
  pool: pool.length,
  excludedMiningProducts: mined.size,
  bandCuts: cuts.map((c) => Number(c.toFixed(4))),
  products: chosen.map((c) => c.row),
};
await writeFile(join(STUDY, "sample.json"), `${JSON.stringify(sample, null, 2)}\n`);
await writeFile(join(STUDY, "listings.jsonl"), `${chosen.map((c) => JSON.stringify(c.raw)).join("\n")}\n`);

const ranges = [1, 2, 3, 4].map((b) => {
  const ns = chosen.filter((c) => c.row.band === b).map((c) => c.row.rating_number);
  return `band ${b}: ${Math.min(...ns)}-${Math.max(...ns)} ratings`;
});
console.log(`pool ${pool.length} (after leaving out ${mined.size} mined products), picked ${chosen.length}`);
console.log(ranges.join("\n"));
