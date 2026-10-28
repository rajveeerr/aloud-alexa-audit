#!/usr/bin/env bun
/**
 * bun apps/cli/src/extract-reviews.ts <reviews.jsonl>... [--per-asin 400]
 *
 * Writes fixtures/reviews/<asin>.jsonl for every dataset fixture, so promise vs proof can run
 * offline. The full review files are hundreds of MB and stay out of git; a fixture keeps up to
 * 400 reviews per product:
 *   - up to 3/4 of them mention a keyword for a claim the listing makes (its recorded grades say
 *     answered or partial), taken round-robin across those claims so a common claim (smudging)
 *     can't crowd out a rarer one (leaking). With no recorded grade, every claim question counts;
 *   - the rest is a random remainder, so the fixture still looks like the product's reviews.
 * Both picks are seeded by a hash, so re-running gives the same files.
 * Input lines are {a: parent_asin, r: rating, t: title, x: text, h: helpful votes}.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { claimKeywords, gradeListing, mentions, normalize, resolveIntentSet, type IntentSet } from "@answerable/core";
import { CachedLlm, FixtureProductData } from "@answerable/providers";

const ROOT = join(import.meta.dir, "../../..");
const FIXTURES = join(ROOT, "fixtures");
const args = process.argv.slice(2);
const perAsinArg = args.indexOf("--per-asin");
const perAsin = perAsinArg >= 0 ? Number(args[perAsinArg + 1]) : 400;
const files = args.filter((a) => a.endsWith(".jsonl"));
if (files.length === 0) {
  console.error("usage: extract-reviews <reviews.jsonl>... [--per-asin 400]");
  process.exit(1);
}

type Line = { a: string; r?: number; t?: string; x?: string; h?: number };

const sets = await Promise.all(
  (await readdir(join(FIXTURES, "intents"))).filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(join(FIXTURES, "intents", f), "utf8")) as IntentSet),
);
const keywordsByAsin = new Map<string, string[][]>();
const dataset = new FixtureProductData(FIXTURES, "dataset");
for (const f of (await readdir(join(FIXTURES, "dataset"))).filter((f) => f.endsWith(".json"))) {
  const raw = await dataset.getListing(f.replace(".json", ""));
  if (!raw) continue;
  const listing = normalize(raw);
  const set = resolveIntentSet(listing, sets);
  let claims = (set?.intents ?? []).filter((i) => i.kind === "claim");
  if (set) {
    // Replayed grades only, never a model call.
    const run = await gradeListing(listing, set, new CachedLlm(null, join(FIXTURES, "llm"), "replay"), "gemini-3.5-flash-lite").catch(() => null);
    const made = new Set(run?.grades.filter((g) => g.status === "answered" || g.status === "partial").map((g) => g.intentId));
    if (claims.some((i) => made.has(i.id))) claims = claims.filter((i) => made.has(i.id));
  }
  keywordsByAsin.set(listing.requestedAsin, claims.map((i) => claimKeywords(i)));
}

const byAsin = new Map<string, Line[]>();
for (const file of files) {
  for await (const text of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!text.trim()) continue;
    const line = JSON.parse(text) as Line;
    if (!keywordsByAsin.has(line.a) || !line.x) continue;
    const list = byAsin.get(line.a) ?? [];
    list.push(line);
    byAsin.set(line.a, list);
  }
}

const hash = (l: Line) => createHash("sha1").update(`${l.t ?? ""}\n${l.x ?? ""}`).digest("hex");
await mkdir(join(FIXTURES, "reviews"), { recursive: true });

for (const [asin, keywordSets] of keywordsByAsin) {
  // Same title and text twice (a review posted on two variants) is kept once.
  const unique = new Map((byAsin.get(asin) ?? []).map((l) => [hash(l), l]));
  const all = [...unique].map(([k, l]) => ({ l, k })).sort((a, b) => (a.k < b.k ? -1 : 1));
  if (all.length === 0) {
    console.log(`${asin}: no reviews in the given files, skipped`);
    continue;
  }
  const review = (l: Line) => ({ title: l.t ?? "", text: l.x ?? "" });
  const queues = keywordSets.map((terms) => all.filter(({ l }) => mentions(review(l), terms)));
  const kept = new Set<string>();
  const keywordQuota = Math.floor((perAsin * 3) / 4);
  for (let round = 0; kept.size < keywordQuota && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const next = q[round];
      if (next && kept.size < keywordQuota) kept.add(next.k);
    }
  }
  const keywordKept = kept.size;
  for (const { k } of all) {
    if (kept.size >= perAsin) break;
    kept.add(k);
  }
  const out = all.filter(({ k }) => kept.has(k)).map(({ l }) => JSON.stringify({ r: l.r, t: l.t ?? "", x: l.x, h: l.h ?? 0 }));
  await writeFile(join(FIXTURES, "reviews", `${asin}.jsonl`), `${out.join("\n")}\n`);
  console.log(`${asin}: ${all.length} reviews, kept ${out.length} (${keywordKept} picked for claim keywords)`);
}
