#!/usr/bin/env bun
/**
 * bun study/run.ts [--record]
 *
 * Grades every product in study/sample.json against the reviewed gel-pen question set and writes
 * study/scores.json. Text only: no images, no briefs, one request per product.
 *
 * Model answers come from study/llm-cache/. Without --record a missing answer is left pending;
 * with --record it is fetched from Gemini (needs GEMINI_API_KEY) and saved, so a run stopped by
 * the daily quota picks up where it left off.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gradeListing, normalize, scoreGrades, type IntentSet } from "@aloud/core";
import { CachedLlm, GeminiLlm, PATIENT_RETRY, ProviderError, QuotaExhaustedError } from "@aloud/providers";
import { jsonl, MODEL, ROOT, STUDY, type Sample, type ScoreRow, type Scores } from "./lib";

/** Free tier allows about 10 requests a minute; keep new requests at least this far apart. */
const GAP_MS = 7000;

const record = process.argv.includes("--record");
const sample = JSON.parse(await readFile(join(STUDY, "sample.json"), "utf8")) as Sample;
const intentSet = JSON.parse(await readFile(join(ROOT, "fixtures/intents/gel-ink-pens.json"), "utf8")) as IntentSet;
const counted = new Set(intentSet.intents.filter((i) => i.kind !== "experience").map((i) => i.id));

const records = new Map<string, unknown>();
for await (const r of jsonl<{ parent_asin: string }>(join(STUDY, "listings.jsonl"))) records.set(r.parent_asin, r);

const gemini = record ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", retry: PATIENT_RETRY }) : null;
const llm = new CachedLlm(gemini, join(STUDY, "llm-cache"), record ? "record" : "replay");

const rows: ScoreRow[] = [];
const pending: string[] = [];
let calls = 0;
let lastCall = 0;
let stopped: string | null = null;

// Take the bands in turn, so a run cut short by the quota still covers all four evenly.
const byBand = [1, 2, 3, 4].map((b) => sample.products.filter((p) => p.band === b));
const order = byBand[0]!.flatMap((_, i) => byBand.flatMap((band) => (band[i] ? [band[i]] : [])));

for (const p of order) {
  const data = records.get(p.asin);
  if (!data) throw new Error(`No dataset record for ${p.asin} in study/listings.jsonl`);
  if (stopped) {
    pending.push(p.asin);
    continue;
  }
  const listing = normalize({ source: "dataset", requestedAsin: p.asin, fetchedAt: "2023-09-01T00:00:00.000Z", data });

  let run;
  try {
    const wait = lastCall + GAP_MS - Date.now();
    if (record && wait > 0) await Bun.sleep(wait);
    run = await gradeListing(listing, intentSet, llm, MODEL);
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      stopped = err.message;
      pending.push(p.asin);
      continue;
    }
    // In replay this is a missing recording. In record it's a failure the retries didn't fix;
    // leave it pending so the next run tries again.
    if (err instanceof ProviderError) {
      if (record) console.error(`${p.asin} failed: ${err.message}`);
      pending.push(p.asin);
      continue;
    }
    throw err;
  }
  if (!run.cached) {
    calls++;
    lastCall = Date.now();
    console.log(`${rows.length + 1}/${sample.products.length} ${p.asin} graded (${run.latencyMs} ms)`);
  }

  const s = scoreGrades(run.grades, intentSet.intents);
  rows.push({
    asin: p.asin,
    band: p.band,
    score: s.score,
    answered: s.answered,
    partial: s.partial,
    missing: s.missing,
    contradicted: s.contradicted,
    notApplicable: s.notApplicable,
    counted: s.counted,
    contentHash: listing.contentHash,
    statuses: Object.fromEntries(run.grades.filter((g) => counted.has(g.intentId)).map((g) => [g.intentId, g.status])),
  });
}

const scores: Scores = { model: MODEL, intentSetVersion: intentSet.version, graded: rows.length, pending, products: rows };
await writeFile(join(STUDY, "scores.json"), `${JSON.stringify(scores, null, 2)}\n`);

console.log(`graded ${rows.length} of ${sample.products.length}, ${calls} new requests, ${pending.length} pending`);
if (stopped) console.log(`stopped: ${stopped}. Run \`bun study:record\` again after the quota resets.`);
else if (pending.length && !record) console.log("Some products have no recording yet. Run `bun study:record` to grade them.");
