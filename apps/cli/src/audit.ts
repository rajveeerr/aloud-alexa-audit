#!/usr/bin/env bun
/**
 * bun cli audit <asin> [--source serpapi|dataset] [--competitors A,B,C] [--live] [--record]
 *
 * Offline by default: listings come from fixtures and model calls replay from fixtures/llm.
 * --record  calls Gemini for anything not recorded yet and saves it.
 * --live    fetches the listing and its competitors through SerpApi when there's no snapshot yet
 *           (1 search for the listing, 1 to find competitors, 1 per competitor). Implies --record.
 *
 * The question set comes from the listing's category path. If no set matches, one is estimated
 * from the listing and its competitors, saved to fixtures/intents, and the report says so.
 * Image transcriptions are saved to fixtures/image-claims/<source>/<asin>.json, so replays never
 * need the image bytes. Recording fetches the images into data/images (not in git).
 */
import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import {
  checkCoverage,
  collectClaims,
  computeGaps,
  draftBriefs,
  estimateIntents,
  findHiddenAnswers,
  gradeListing,
  leafCategory,
  normalize,
  resolveIntentSet,
  scoreGrades,
  transcribeImages,
  TRANSCRIBE_PROMPT_VERSION,
  type Brief,
  type Gap,
  type Grade,
  type ImageBytes,
  type ImageClaim,
  type IntentSet,
  type Listing,
  type RawListing,
} from "@answerable/core";
import {
  CachedLlm,
  FixtureProductData,
  GeminiLlm,
  ImageStore,
  pickCompetitors as chooseCompetitors,
  SerpApiProductData,
  SerpApiSearch,
} from "@answerable/providers";

const ROOT = join(import.meta.dir, "../../..");
const FIXTURES = join(ROOT, "fixtures");
const MODEL = "gemini-3.5-flash-lite";
const MAX_IMAGES = 16;

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const asin = args.find((a) => /^B0[A-Z0-9]{8}$/.test(a));
const source = (opt("source") === "dataset" ? "dataset" : "serpapi") as "dataset" | "serpapi";
const live = args.includes("--live");
const record = live || args.includes("--record");

if (!asin) {
  console.error("usage: bun cli audit <asin> [--source serpapi|dataset] [--competitors A,B,C] [--live] [--record]");
  process.exit(1);
}

const gemini = record ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "" }) : null;
const llm = new CachedLlm(gemini, join(FIXTURES, "llm"), record ? "record" : "replay");
const fixtures = new FixtureProductData(FIXTURES, source);
const serpKey = process.env.SERPAPI_KEY ?? "";
const serp = live && source === "serpapi" ? new SerpApiProductData({ apiKey: serpKey, snapshotDir: join(FIXTURES, "serpapi") }) : null;

/** A saved snapshot first; SerpApi only when live and nothing is saved. */
async function getListing(a: string): Promise<RawListing | null> {
  return (await fixtures.getListing(a)) ?? (serp ? await serp.getListing(a) : null);
}

const raw = await getListing(asin);
if (!raw) {
  console.error(`No ${source} listing for ${asin}${live ? "" : " (try --live)"}`);
  process.exit(1);
}
const listing = normalize(raw);

const competitors: Listing[] = [];
for (const c of await findCompetitors(listing)) {
  if (competitors.length >= 4) break;
  const craw = await getListing(c);
  if (!craw) continue;
  const cl = normalize(craw);
  // A brand's own other products aren't competitors.
  if (cl.meta.brand && listing.meta.brand && cl.meta.brand.toLowerCase() === listing.meta.brand.toLowerCase()) continue;
  competitors.push(cl);
}

const intentSet = await loadIntentSet(listing, competitors);
const run = await gradeListing(listing, intentSet, llm, MODEL);
const score = scoreGrades(run.grades, intentSet.intents);
printReport(listing, intentSet, run.grades, score, run);

const claims = (await loadImageClaims(listing, gemini)) ?? [];
const coverage = await checkCoverage(listing, claims, intentSet.intents, llm, MODEL);
const hidden = findHiddenAnswers(run.grades, claims, coverage.matches, intentSet.intents);
if (claims.length) printHidden(listing, intentSet, claims, coverage.matches, hidden);

const graded = [];
for (const c of competitors) graded.push({ listing: c, grades: (await gradeListing(c, intentSet, llm, MODEL)).grades });
const gaps = computeGaps({ listing, grades: run.grades }, graded, intentSet.intents, hidden);
const briefs = await draftBriefs(listing, gaps, run.grades, claims, intentSet.intents, llm, MODEL);
printFixes(intentSet, gaps, briefs.briefs, competitors.map((c) => c.meta.brand ?? c.asin));

/**
 * --competitors wins. Live: search the listing's leaf category and take the top organic results.
 * Offline: every other fixture from the same source in the same leaf category.
 */
async function findCompetitors(l: Listing): Promise<string[]> {
  const flag = opt("competitors");
  if (flag) return flag.split(",").filter(Boolean);
  if (live && source === "serpapi") {
    const query = leafCategory(l) ?? l.fields.find((f) => f.id === "title")?.text.split(",")[0] ?? "";
    const search = new SerpApiSearch({ apiKey: serpKey, snapshotDir: join(FIXTURES, "serpapi-search") });
    const found = chooseCompetitors(await search.search(query), [l.asin, l.requestedAsin], 4);
    if (found.length > 0) return found;
    // Amazon search sometimes returns nothing. The product page's own related products are a
    // free fallback (no extra search); same-brand ones are dropped after fetching.
    const related = ((raw!.data as { related_asins?: string[] }).related_asins ?? []).slice(0, 6);
    console.log(`\nSearch for "${query}" returned nothing; using ${related.length} related products from the page.`);
    return related;
  }
  const same: string[] = [];
  for (const f of await readdir(join(FIXTURES, source))) {
    const other = f.replace(".json", "");
    if (other === asin) continue;
    const o = await fixtures.getListing(other);
    if (o && leafCategory(normalize(o)) === leafCategory(l)) same.push(other);
  }
  return same;
}

/** The matching set from fixtures/intents, or an estimated one saved there for next time. */
async function loadIntentSet(l: Listing, rivals: Listing[]): Promise<IntentSet> {
  const dir = join(FIXTURES, "intents");
  const sets: IntentSet[] = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) sets.push(JSON.parse(await readFile(join(dir, f), "utf8")));
  const found = resolveIntentSet(l, sets);
  if (found) return found;

  const name = leafCategory(l) ?? "Unknown";
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  console.log(`\nNo question set for "${name}". Estimating one from this listing and ${rivals.length} competitors.`);
  const set = await estimateIntents({ categoryId: id, categoryName: name, match: [name], version: "estimated-2026-10-27.1", listings: [l, ...rivals] }, llm, MODEL);
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ ...set, source: "Estimated from listings; no reviews were mined. Not yet reviewed by hand." }, null, 2));
  return set;
}

async function loadImageClaims(l: Listing, model: GeminiLlm | null): Promise<ImageClaim[] | null> {
  // Keyed by source too: the same ASIN can be both a 2023 dataset listing and a live one.
  const dir = join(FIXTURES, "image-claims", l.source);
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
  const saveRecord = {
    asin: l.requestedAsin,
    promptVersion: TRANSCRIBE_PROMPT_VERSION,
    model: t.model,
    usage: t.usage,
    images: images.length,
    skippedImageIds: t.skippedImageIds,
    modelOutput: t.modelOutput,
  };
  await writeFile(path, JSON.stringify(saveRecord, null, 2));
  const skipped = t.skippedImageIds.length ? `, ${t.skippedImageIds.length} refused (${t.skippedImageIds.join(", ")})` : "";
  console.log(`\nTranscribed ${images.length} images${skipped}: ${t.usage.inputTokens} in / ${t.usage.outputTokens} out tokens`);
  return t.claims;
}

function printReport(l: Listing, set: IntentSet, grades: Grade[], s: ReturnType<typeof scoreGrades>, r: typeof run) {
  const intents = new Map(set.intents.map((i) => [i.id, i]));
  const mark = { answered: "✓", partial: "~", missing: "✗", contradicted: "!", not_applicable: "-" } as const;

  console.log(`\n${l.meta.brand ?? ""} ${l.asin}${l.asin !== l.requestedAsin ? ` (requested ${l.requestedAsin})` : ""}`);
  console.log(l.fields.find((f) => f.id === "title")?.text ?? "");
  const basis = set.basis === "estimated" ? "ESTIMATED questions (no reviews mined), equal weights" : `questions mined from ${set.sampleSize} reviews`;
  console.log(`Category: ${set.categoryName}, ${basis}${set.reviewed ? "" : ", not yet reviewed by hand"}`);
  console.log(`\nScore ${s.score ?? "n/a"}${set.basis === "estimated" ? " (estimated)" : ""}: answers ${s.answered} of ${s.counted} questions, ${s.partial} partly, ${s.contradicted} contradicted`);
  console.log(`${r.model}, ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens, ${r.cached ? "cached" : `${r.latencyMs} ms`}\n`);

  const order = ["contradicted", "missing", "partial", "answered", "not_applicable"];
  const sorted = [...grades].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (intents.get(b.intentId)?.frequency ?? 0) - (intents.get(a.intentId)?.frequency ?? 0),
  );
  for (const g of sorted) {
    const i = intents.get(g.intentId)!;
    const flags = g.flags.length ? `  [${g.flags.join(", ")}]` : "";
    const asked = set.basis === "estimated" ? "" : ` (${i.frequency})`;
    console.log(`${mark[g.status]} ${i.question}${asked}${flags}`);
    for (const q of g.quotes) console.log(`    ${q.fieldId}: "${q.text}"`);
  }
}

function printHidden(
  l: Listing,
  set: IntentSet,
  imageClaims: ImageClaim[],
  matches: Awaited<ReturnType<typeof checkCoverage>>["matches"],
  found: ReturnType<typeof findHiddenAnswers>,
) {
  const intents = new Map(set.intents.map((i) => [i.id, i]));
  const kinds = new Map(l.images.map((i) => [i.id, i.kind]));
  const imageOnly = matches.filter((m) => m.coverage === "image_only").length;
  console.log(`\nImages: ${imageClaims.length} claims found, ${imageOnly} only in images`);
  console.log(`Hidden answers: ${found.length}`);
  for (const h of found) {
    const i = intents.get(h.intentId)!;
    console.log(`  ${i.question} (${i.frequency}) — text: ${h.textStatus}`);
    for (const c of h.claims) console.log(`    "${c.text}"  in ${c.imageIds.map((id) => `${id} (${kinds.get(id)})`).join(", ")}`);
  }
}

function printFixes(set: IntentSet, allGaps: Gap[], list: Brief[], competitorNames: string[]) {
  const intents = new Map(set.intents.map((i) => [i.id, i]));
  console.log(`\nGaps against ${competitorNames.join(", ") || "no competitors"}: ${allGaps.length}`);
  console.log(`\nFix list (top ${list.length})`);
  list.forEach((b, n) => {
    const gap = allGaps.find((g) => g.intentId === b.intentId)!;
    const share = gap.competitorShare === null ? "" : `, ${gap.competitorsAnswering.length} of ${competitorNames.length} competitors answer it`;
    const asking = set.basis === "estimated" ? "estimated question" : `${gap.frequency} asking`;
    console.log(`\n${n + 1}. ${intents.get(b.intentId)!.question}  [priority ${b.priority}: ${asking}${share}]`);
    console.log(`   ${b.action} → ${b.target}${b.flags.length ? `  [${b.flags.join(", ")}]` : ""}`);
    if (b.draft) console.log(`   draft: "${b.draft}"`);
    if (b.rejectedStatements) console.log(`   rejected from model draft: ${b.rejectedStatements.map((x) => `"${x}"`).join(", ")}`);
    if (b.needsFromBrand) console.log(`   needs from brand: ${b.needsFromBrand}`);
    for (const s of b.sources) console.log(`   source ${s.kind} ${s.id}: "${s.text}"`);
  });
}
