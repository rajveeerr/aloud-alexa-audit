#!/usr/bin/env bun
/**
 * bun apps/cli/src/mine.ts --id <category-id> --name "<Category Name>" --reviews <file.jsonl>
 *   [--asins <file>] [--match "Name,Other Name"] [--record]
 *
 * Mines a question set from reviews and writes fixtures/intents/<id>.json, marked reviewed: false.
 * Reviews are JSONL lines of {a: asin, t: title, x: text, h: helpful votes}, as notes/scripts
 * filter_reviews.py writes them. Without --record, model calls replay from fixtures/llm.
 */
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { mineIntents, type ReviewText } from "@aloud/core";
import { CachedLlm, GeminiLlm } from "@aloud/providers";

const ROOT = join(import.meta.dir, "../../..");
const MODEL = "gemini-3.5-flash-lite";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = opt("id");
const name = opt("name");
const reviewsPath = opt("reviews");
if (!id || !name || !reviewsPath) {
  console.error('usage: mine --id <category-id> --name "<Category Name>" --reviews <file.jsonl> [--asins <file>] [--match "A,B"] [--record]');
  process.exit(1);
}
const record = args.includes("--record");
const asinsPath = opt("asins");
const keep = asinsPath ? new Set((await readFile(asinsPath, "utf8")).split("\n").map((s) => s.trim()).filter(Boolean)) : null;

const reviews: ReviewText[] = [];
for await (const line of createInterface({ input: createReadStream(reviewsPath), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as { a: string; t: string; x: string; h: number };
  if (keep && !keep.has(r.a)) continue;
  reviews.push({ asin: r.a, title: r.t ?? "", text: r.x ?? "", helpfulVotes: r.h ?? 0 });
}

const gemini = record ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "" }) : null;
const llm = new CachedLlm(gemini, join(ROOT, "fixtures/llm"), record ? "record" : "replay");
const { intentSet, report } = await mineIntents(
  { categoryId: id, categoryName: name, match: (opt("match") ?? name).split(",").map((s) => s.trim()), version: "mined-2026-10-27.1", reviews },
  llm,
  MODEL,
);

const out = join(ROOT, "fixtures/intents", `${id}.json`);
await writeFile(out, JSON.stringify({ ...intentSet, source: `Mined from ${report.sampleSize} reviews (Amazon Reviews 2023). Not yet reviewed by hand.` }, null, 2));

console.log(`${name}: ${reviews.length} reviews in, ${report.sampleSize} sampled, ${report.distinctNeeds} distinct needs, ${Math.round(report.coverage * 100)}% of reviews with a need covered`);
console.log(`${report.usage.requests} requests, ${report.usage.inputTokens} in / ${report.usage.outputTokens} out tokens`);
console.log(`\n${intentSet.intents.length} questions:`);
for (const i of intentSet.intents) console.log(`  ${String(i.frequency).padStart(4)}  ${i.kind.padEnd(10)} ${i.id.padEnd(28)} ${i.question}${i.conditional ? "  [conditional]" : ""}`);
if (report.dropped.length) console.log(`\nDropped as too rare: ${report.dropped.join(", ")}`);
console.log(`\nMost common needs left out: ${report.unassigned.slice(0, 10).map(([n, c]) => `${n} (${c})`).join(", ")}`);
console.log(`\nWrote ${out}`);
