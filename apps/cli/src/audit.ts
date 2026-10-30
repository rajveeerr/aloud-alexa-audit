#!/usr/bin/env bun
/**
 * bun cli audit <asin> [--source serpapi|dataset] [--competitors A,B,C] [--live] [--record]
 *
 * Offline by default: listings come from fixtures and model calls replay from fixtures/llm.
 * --record  calls Gemini for anything not recorded yet and saves it.
 * --live    fetches the listing and its competitors through SerpApi when there's no snapshot yet
 *           (1 search for the listing, 1 to find competitors, 1 per competitor). Implies --record.
 *
 * The whole audit runs in @aloud/pipeline runAudit, the same code the API worker uses.
 */
import { join } from "node:path";
import type { AuditResult } from "@aloud/pipeline";
import { AuditError, fsStores, runAudit } from "@aloud/pipeline";
import { CachedLlm, GeminiLlm, PATIENT_RETRY } from "@aloud/providers";

const ROOT = join(import.meta.dir, "../../..");
const FIXTURES = join(ROOT, "fixtures");
const MODEL = "gemini-3.5-flash-lite";

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

// A live run spends real API calls, so say plainly what's missing instead of failing deep inside.
const missingKeys = [record && !process.env.GEMINI_API_KEY && "GEMINI_API_KEY", live && !process.env.SERPAPI_KEY && "SERPAPI_KEY"].filter(Boolean);
if (missingKeys.length > 0) {
  console.error(`${live ? "--live" : "--record"} needs ${missingKeys.join(" and ")} in .env. Without keys, leave the flag off to replay saved audits.`);
  process.exit(1);
}

const gemini = record ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", retry: PATIENT_RETRY }) : null;
const llm = new CachedLlm(gemini, join(FIXTURES, "llm"), record ? "record" : "replay");
const stores = fsStores({
  fixturesDir: FIXTURES,
  imageCacheDir: join(ROOT, "data/images"),
  ...(live && { serpApiKey: process.env.SERPAPI_KEY ?? "" }),
});

const competitors = opt("competitors")?.split(",").filter(Boolean);
try {
  const result = await runAudit(
    { asin, source, live, ...(competitors && { competitors }) },
    // Image transcriptions are saved separately, so the vision model is the uncached client.
    { llm, vision: gemini, model: MODEL, ...stores, images: record ? stores.images : null },
  );
  print(result);
} catch (err) {
  if (err instanceof AuditError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

function print(r: AuditResult) {
  const { listing: l, intentSet: set, score: s } = r;
  const intents = new Map(set.intents.map((i) => [i.id, i]));
  const estimated = set.basis === "estimated";
  const mark = { answered: "✓", partial: "~", missing: "✗", contradicted: "!", not_applicable: "-" } as const;

  console.log(`\n${l.meta.brand ?? ""} ${l.asin}${l.asin !== l.requestedAsin ? ` (requested ${l.requestedAsin})` : ""}`);
  console.log(l.fields.find((f) => f.id === "title")?.text ?? "");
  const basis = estimated ? "ESTIMATED questions (no reviews mined), equal weights" : `questions mined from ${set.sampleSize} reviews`;
  console.log(`Category: ${set.categoryName}, ${basis}${set.reviewed ? "" : ", not yet reviewed by hand"}`);
  console.log(`\nScore ${s.score ?? "n/a"}${estimated ? " (estimated)" : ""}: answers ${s.answered} of ${s.counted} questions, ${s.partial} partly, ${s.contradicted} contradicted`);
  console.log(`${r.usage.requests} model calls (${r.usage.cachedRequests} cached), ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens\n`);

  const order = ["contradicted", "missing", "partial", "answered", "not_applicable"];
  const sorted = [...r.grades].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (intents.get(b.intentId)?.frequency ?? 0) - (intents.get(a.intentId)?.frequency ?? 0),
  );
  for (const g of sorted) {
    const i = intents.get(g.intentId)!;
    const flags = g.flags.length ? `  [${g.flags.join(", ")}]` : "";
    console.log(`${mark[g.status]} ${i.question}${estimated ? "" : ` (${i.frequency})`}${flags}`);
    for (const q of g.quotes) console.log(`    ${q.fieldId}: "${q.text}"`);
  }

  if (r.imageClaims.length) {
    const kinds = new Map(l.images.map((i) => [i.id, i.kind]));
    console.log(`\nImages: ${r.imageClaims.length} claims found, ${r.coverage.filter((m) => m.coverage === "image_only").length} only in images`);
    console.log(`Hidden answers: ${r.hiddenAnswers.length}`);
    for (const h of r.hiddenAnswers) {
      const i = intents.get(h.intentId)!;
      console.log(`  ${i.question}${estimated ? "" : ` (${i.frequency})`} — text: ${h.textStatus}`);
      for (const c of h.claims) console.log(`    "${c.text}"  in ${c.imageIds.map((id) => `${id} (${kinds.get(id)})`).join(", ")}`);
    }
  }

  if (r.proof) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const verdict = { backed: "backed", contested: "CONTESTED", not_enough_evidence: "not enough evidence" } as const;
    console.log(`\nPromise vs proof: ${r.proof.claims.length} claims checked against ${r.proof.reviews} saved reviews`);
    for (const c of r.proof.claims) {
      const where = c.sources.map((s) => s.id).join(", ");
      console.log(`  ${verdict[c.verdict]}: ${intents.get(c.intentId)?.question}  "${c.claim}" (${where})`);
      const n = c.counts;
      console.log(`    ${c.matching} reviews mention it, ${c.sampled} labelled: ${n.supports} support, ${n.contradicts} contradict, ${n.mixed} mixed, ${n.unrelated} unrelated${n.unlabelled ? `, ${n.unlabelled} unlabelled` : ""}`);
      if (c.contradiction && c.support) {
        console.log(`    contradicted by ${pct(c.contradiction.rate)} (${pct(c.contradiction.low)}-${pct(c.contradiction.high)}), supported by ${pct(c.support.rate)} (${pct(c.support.low)}-${pct(c.support.high)}) of reviews that discuss it`);
      }
      for (const t of c.examples.contradicts) console.log(`    ✗ "${t}"`);
      for (const t of c.examples.mixed.slice(0, 1)) console.log(`    ~ "${t}"`);
      for (const t of c.examples.supports.slice(0, c.verdict === "contested" ? 1 : 2)) console.log(`    ✓ "${t}"`);
    }
  }

  const names = r.competitors.map((c) => c.brand ?? c.asin);
  console.log(`\nGaps against ${names.join(", ") || "no competitors"}: ${r.gaps.length}`);
  console.log(`\nFix list (top ${r.briefs.length})`);
  r.briefs.forEach((b, n) => {
    const gap = r.gaps.find((g) => g.intentId === b.intentId)!;
    const share = gap.competitorShare === null ? "" : `, ${gap.competitorsAnswering.length} of ${names.length} competitors answer it`;
    const asking = estimated ? "estimated question" : `${gap.frequency} asking`;
    console.log(`\n${n + 1}. ${intents.get(b.intentId)!.question}  [priority ${b.priority}: ${asking}${share}]`);
    console.log(`   ${b.action} → ${b.target}${b.flags.length ? `  [${b.flags.join(", ")}]` : ""}`);
    if (b.draft) console.log(`   draft: "${b.draft}"`);
    if (b.rejectedStatements) console.log(`   rejected from model draft: ${b.rejectedStatements.map((x) => `"${x}"`).join(", ")}`);
    if (b.needsFromBrand) console.log(`   needs from brand: ${b.needsFromBrand}`);
    for (const src of b.sources) console.log(`   source ${src.kind} ${src.id}: "${src.text}"`);
  });
  if (r.notes.length) console.log(`\nNotes:\n${r.notes.map((n) => `- ${n}`).join("\n")}`);
}
