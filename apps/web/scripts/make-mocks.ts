#!/usr/bin/env bun
/**
 * bun run --cwd apps/web mocks
 *
 * Replays the recorded audits (no network, no keys) and writes each report to src/mocks/,
 * so the web app can run with VITE_USE_MOCKS=1 on exactly what the pipeline produces.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fsStores, runAudit } from "@aloud/pipeline";
import { CachedLlm } from "@aloud/providers";

const ROOT = join(import.meta.dir, "../../..");
const OUT = join(import.meta.dir, "../src/mocks/reports");

const FIXTURES = [
  { asin: "B0C9W8DD9S", source: "serpapi" },
  { asin: "B001GAOTSW", source: "serpapi" },
  { asin: "B097CF46RC", source: "serpapi" },
  { asin: "B0BGPYR8Q3", source: "serpapi" },
  { asin: "B0BSMKF5BQ", source: "serpapi" },
  { asin: "B097CF46RC", source: "dataset" },
  { asin: "B09VD1Z3TK", source: "dataset" },
  { asin: "B08PD98HYG", source: "dataset" },
  { asin: "B00P6N6LC2", source: "dataset" },
] as const;

const stores = fsStores({ fixturesDir: join(ROOT, "fixtures"), imageCacheDir: "/tmp/aloud-mock-images" });
const deps = { llm: new CachedLlm(null, join(ROOT, "fixtures/llm"), "replay"), vision: null, model: "gemini-3.5-flash-lite", ...stores, images: null };

await mkdir(OUT, { recursive: true });
const index = [];
for (const f of FIXTURES) {
  const report = await runAudit({ asin: f.asin, source: f.source }, deps);
  await writeFile(join(OUT, `${f.source}-${f.asin}.json`), JSON.stringify(report, null, 2) + "\n");
  index.push({
    asin: f.asin,
    source: f.source,
    brand: report.listing.meta.brand,
    title: report.listing.fields.find((x) => x.id === "title")?.text ?? "",
    category: report.intentSet.categoryName,
    score: report.score.score,
    contentHash: report.listing.contentHash,
  });
  console.log(`${f.source} ${f.asin}: score ${report.score.score}, ${report.hiddenAnswers.length} hidden, ${report.briefs.length} briefs`);
}
await writeFile(join(OUT, "../listings.json"), JSON.stringify(index, null, 2) + "\n");
