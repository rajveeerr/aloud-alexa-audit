#!/usr/bin/env bun
/**
 * bun cli audit <asin> [--source serpapi|dataset] [--record]
 *
 * Prints a report from fixtures. By default LLM calls replay from fixtures/llm and fail on a
 * miss, so running it costs nothing. --record calls Gemini for misses and saves the answers.
 *
 * Image transcriptions are saved to fixtures/image-claims/<source>/<asin>.json, so replays never need the
 * image bytes. Recording fetches the images into data/images (not in git).
 */
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  checkCoverage,
  collectClaims,
  findHiddenAnswers,
  gradeListing,
  normalize,
  scoreGrades,
  transcribeImages,
  TRANSCRIBE_PROMPT_VERSION,
  type Grade,
  type ImageBytes,
  type ImageClaim,
  type IntentSet,
  type Listing,
} from "@answerable/core";
import { CachedLlm, FixtureProductData, GeminiLlm, ImageStore } from "@answerable/providers";

const ROOT = join(import.meta.dir, "../../..");
const MODEL = "gemini-3.5-flash-lite";
const MAX_IMAGES = 16;

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

const claims = await loadImageClaims(listing, gemini);
if (claims) {
  const coverage = await checkCoverage(listing, claims, intentSet.intents, llm, MODEL);
  const hidden = findHiddenAnswers(run.grades, claims, coverage.matches, intentSet.intents);
  printHidden(listing, intentSet, claims, coverage.matches, hidden);
}

async function loadImageClaims(l: Listing, model: GeminiLlm | null): Promise<ImageClaim[] | null> {
  // Keyed by source too: the same ASIN can be both a 2023 dataset listing and a live one.
  const dir = join(ROOT, "fixtures/image-claims", l.source);
  const path = join(dir, `${l.requestedAsin}.json`);
  const saved = await readFile(path, "utf8").then(JSON.parse, () => null);
  if (saved && saved.promptVersion === TRANSCRIBE_PROMPT_VERSION) return collectClaims(l, saved.modelOutput);
  if (!model) return null;

  const store = new ImageStore({ cacheDir: join(ROOT, "data/images") });
  const images: ImageBytes[] = [];
  for (const img of l.images.slice(0, MAX_IMAGES)) {
    const data = await store.get(img.url);
    if (data) images.push({ id: img.id, ...data });
  }
  const t = await transcribeImages(l, images, model, MODEL);
  await mkdir(dir, { recursive: true });
  const record = {
    asin: l.requestedAsin,
    promptVersion: TRANSCRIBE_PROMPT_VERSION,
    model: t.model,
    usage: t.usage,
    images: images.length,
    skippedImageIds: t.skippedImageIds,
    modelOutput: t.modelOutput,
  };
  await writeFile(path, JSON.stringify(record, null, 2));
  const skipped = t.skippedImageIds.length ? `, ${t.skippedImageIds.length} refused (${t.skippedImageIds.join(", ")})` : "";
  console.log(`\nTranscribed ${images.length} images${skipped}: ${t.usage.inputTokens} in / ${t.usage.outputTokens} out tokens`);
  return t.claims;
}

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

function printHidden(
  l: Listing,
  set: IntentSet,
  claims: ImageClaim[],
  matches: Awaited<ReturnType<typeof checkCoverage>>["matches"],
  hidden: ReturnType<typeof findHiddenAnswers>,
) {
  const intents = new Map(set.intents.map((i) => [i.id, i]));
  const kinds = new Map(l.images.map((i) => [i.id, i.kind]));
  const imageOnly = matches.filter((m) => m.coverage === "image_only").length;
  console.log(`\nImages: ${claims.length} claims found, ${imageOnly} only in images`);
  console.log(`Hidden answers: ${hidden.length}`);
  for (const h of hidden) {
    const i = intents.get(h.intentId)!;
    console.log(`  ${i.question} (${i.frequency}) — text: ${h.textStatus}`);
    for (const c of h.claims) console.log(`    "${c.text}"  in ${c.imageIds.map((id) => `${id} (${kinds.get(id)})`).join(", ")}`);
  }
}
