#!/usr/bin/env bun
/**
 * bun cli audit <asin> [--source serpapi|dataset] [--record]
 *
 * Prints a report from fixtures. By default LLM calls replay from fixtures/llm and fail on a
 * miss, so running it costs nothing. --record calls Gemini for misses and saves the answers.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { gradeListing, normalize, scoreGrades, type Grade, type IntentSet, type Listing } from "@answerable/core";
import { CachedLlm, FixtureProductData, GeminiLlm } from "@answerable/providers";

const ROOT = join(import.meta.dir, "../../..");
const MODEL = "gemini-3.5-flash-lite";

const args = process.argv.slice(2);
const asin = args.find((a) => /^B0[A-Z0-9]{8}$/.test(a));
const source = (args[args.indexOf("--source") + 1] === "dataset" ? "dataset" : "serpapi") as "dataset" | "serpapi";
const record = args.includes("--record");

if (!asin) {
  console.error("usage: bun cli audit <asin> [--source serpapi|dataset] [--record]");
  process.exit(1);
}

const raw = await new FixtureProductData(join(ROOT, "fixtures"), source).getListing(asin);
if (!raw) {
  console.error(`No ${source} fixture for ${asin}`);
  process.exit(1);
}
const listing = normalize(raw);
const intentSet = JSON.parse(await readFile(join(ROOT, "fixtures/intents/gel-ink-pens.json"), "utf8")) as IntentSet;

const gemini = record ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "" }) : null;
const llm = new CachedLlm(gemini, join(ROOT, "fixtures/llm"), record ? "record" : "replay");

const run = await gradeListing(listing, intentSet, llm, MODEL);
const score = scoreGrades(run.grades, intentSet.intents);
printReport(listing, intentSet, run.grades, score, run);

function printReport(l: Listing, set: IntentSet, grades: Grade[], s: ReturnType<typeof scoreGrades>, r: typeof run) {
  const intents = new Map(set.intents.map((i) => [i.id, i]));
  const mark = { answered: "✓", partial: "~", missing: "✗", contradicted: "!", not_applicable: "-" } as const;

  console.log(`\n${l.meta.brand ?? ""} ${l.asin}${l.asin !== l.requestedAsin ? ` (requested ${l.requestedAsin})` : ""}`);
  console.log(l.fields.find((f) => f.id === "title")?.text ?? "");
  console.log(`\nScore ${s.score ?? "n/a"}: answers ${s.answered} of ${s.counted} questions, ${s.partial} partly, ${s.contradicted} contradicted`);
  console.log(`${r.model}, ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens, ${r.cached ? "cached" : `${r.latencyMs} ms`}\n`);

  const order = ["contradicted", "missing", "partial", "answered", "not_applicable"];
  const sorted = [...grades].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (intents.get(b.intentId)?.frequency ?? 0) - (intents.get(a.intentId)?.frequency ?? 0),
  );
  for (const g of sorted) {
    const i = intents.get(g.intentId)!;
    const flags = g.flags.length ? `  [${g.flags.join(", ")}]` : "";
    console.log(`${mark[g.status]} ${i.question} (${i.frequency})${flags}`);
    for (const q of g.quotes) console.log(`    ${q.fieldId}: "${q.text}"`);
  }
}
