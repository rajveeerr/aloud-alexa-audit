import {
  checkCoverage,
  checkProof,
  proofFromTopics,
  listingClaims,
  collectClaims,
  computeGaps,
  draftBriefs,
  estimateIntents,
  insightIntents,
  mineIntents,
  type ReviewText,
  findHiddenAnswers,
  gradeListing,
  leafCategory,
  normalize,
  resolveIntentSet,
  scoreGrades,
  transcribeImages,
  TRANSCRIBE_PROMPT_VERSION,
  type Brief,
  type ClaimMatch,
  type Gap,
  type Grade,
  type HiddenAnswer,
  type ImageBytes,
  type ImageClaim,
  type IntentSet,
  type JsonModel,
  type JsonRequest,
  type Listing,
  type ListingSource,
  type PastedListing,
  type ProofRun,
  type RawListing,
  type Score,
} from "@aloud/core";
import { pickCompetitors, ProviderError, QuotaExhaustedError } from "@aloud/providers";
import type { ImageClaimStore, ImageFetcher, IntentSetStore, ListingStore, ReviewStore, SearchStore } from "./stores";

export type AuditRequest = {
  asin: string;
  source: ListingSource;
  /** Required for source "paste". */
  paste?: PastedListing;
  /** For pasted listings, which have no category path. */
  category?: string;
  /** Competitor ASINs. When absent they're found from search or saved listings. */
  competitors?: string[];
  /** Allow live SerpApi fetches and searches (costs searches). */
  live?: boolean;
  /**
   * At most this many competitors, overriding deps.maxCompetitors. 0 skips competitors entirely:
   * no search and no extra listing fetches, so a live audit costs one SerpApi call.
   */
  maxCompetitors?: number;
  /**
   * When the category has no question set: mine one from real reviews of this product type
   * (Walmart, through SerpApi; about 5 searches, then saved for the category). Default true. The
   * public widget turns it off so strangers can't spend the search quota.
   */
  mineReviews?: boolean;
};

/** Real reviews for a product type, by search query. See WalmartReviews in providers. */
export type ReviewSource = {
  forQuery(query: string): Promise<{ query: string; products: { usItemId: string; title: string; reviewCount: number }[]; reviews: ReviewText[] } | null>;
};

export type AuditDeps = {
  /** Text model calls. Pass a cached client so repeats are free. */
  llm: JsonModel;
  /** Vision model for image transcription. Null means only saved transcriptions are used. */
  vision: JsonModel | null;
  model: string;
  listings: ListingStore;
  search: SearchStore | null;
  intentSets: IntentSetStore;
  imageClaims: ImageClaimStore;
  images: ImageFetcher | null;
  /** Product reviews for promise vs proof. Absent, or null for a product, means the check is skipped. */
  reviews?: ReviewStore | null;
  /** Reviews of a product type, for mining a question set when a category has none. */
  categoryReviews?: ReviewSource | null;
  maxImages?: number;
  maxCompetitors?: number;
  log?: (message: string) => void;
};

export type CompetitorResult = { asin: string; brand?: string; title: string; score: Score; grades: Grade[] };

export type AuditResult = {
  listing: Listing;
  intentSet: IntentSet;
  grades: Grade[];
  score: Score;
  imageClaims: ImageClaim[];
  coverage: ClaimMatch[];
  hiddenAnswers: HiddenAnswer[];
  /** Images the vision model refused to read. */
  skippedImageIds: string[];
  competitors: CompetitorResult[];
  gaps: Gap[];
  briefs: Brief[];
  /** Promise vs proof: the listing's claims checked against its own reviews. Only when reviews exist. */
  proof?: ProofRun;
  usage: { requests: number; cachedRequests: number; inputTokens: number; outputTokens: number };
  /** Things worth telling the user: an estimated question set, a failed search, missing competitors. */
  notes: string[];
};

export class AuditError extends Error {
  constructor(
    message: string,
    readonly code: "listing_not_found" | "bad_request",
  ) {
    super(message);
    this.name = "AuditError";
  }
}

/** Counts every model call the audit makes, cached or not, so cost can be reported. */
function metered(model: JsonModel, usage: AuditResult["usage"]): JsonModel {
  return {
    async generateJson<T>(req: JsonRequest) {
      const res = await model.generateJson<T>(req);
      usage.requests++;
      if (res.cached) usage.cachedRequests++;
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      return res;
    },
  };
}

/**
 * The whole audit for one listing:
 * fetch → normalize → question set → grade → read images → hidden answers → promise vs proof
 * → competitors → gaps → fixes.
 * The CLI, the API worker and the tests all call this, so they can't drift apart.
 */
export async function runAudit(req: AuditRequest, deps: AuditDeps): Promise<AuditResult> {
  const usage = { requests: 0, cachedRequests: 0, inputTokens: 0, outputTokens: 0 };
  const llm = metered(deps.llm, usage);
  const vision = deps.vision ? metered(deps.vision, usage) : null;
  const notes: string[] = [];
  const log = deps.log ?? (() => {});
  const maxCompetitors = req.maxCompetitors ?? deps.maxCompetitors ?? 4;

  const raw = await loadRaw(req, deps);
  if (!raw) throw new AuditError(`No ${req.source} listing for ${req.asin}${req.live ? "" : " (not saved; live fetch not allowed)"}`, "listing_not_found");
  let listing = normalize(raw);
  if (req.source === "paste" && req.category) listing = { ...listing, meta: { ...listing.meta, categories: [req.category] } };
  log(`normalized ${listing.asin}: ${listing.fields.length} fields, ${listing.images.length} images`);

  const competitors = await findCompetitors(req, listing, raw, deps, notes, maxCompetitors);
  log(`competitors: ${competitors.map((c) => c.asin).join(", ") || "none"}`);

  const intentSet = await loadIntentSet(listing, competitors, deps, llm, notes, req.mineReviews !== false);
  const grades = (await gradeListing(listing, intentSet, llm, deps.model)).grades;
  const score = scoreGrades(grades, intentSet.intents);
  log(`graded: score ${score.score}`);

  const { claims, skipped } = await loadImageClaims(listing, deps, vision, notes);
  const coverage = (await checkCoverage(listing, claims, intentSet.intents, llm, deps.model)).matches;
  const hiddenAnswers = findHiddenAnswers(grades, claims, coverage, intentSet.intents);

  const proof = await checkListingProof(listing, grades, claims, coverage, intentSet, deps, llm, notes, log);

  const competitorResults: CompetitorResult[] = [];
  for (const c of competitors) {
    const cg = (await gradeListing(c, intentSet, llm, deps.model)).grades;
    competitorResults.push({
      asin: c.asin,
      ...(c.meta.brand && { brand: c.meta.brand }),
      title: c.fields.find((f) => f.id === "title")?.text ?? "",
      score: scoreGrades(cg, intentSet.intents),
      grades: cg,
    });
  }

  const gaps = computeGaps(
    { listing, grades },
    competitors.map((c, i) => ({ listing: c, grades: competitorResults[i]!.grades })),
    intentSet.intents,
    hiddenAnswers,
  );
  const briefs = (await draftBriefs(listing, gaps, grades, claims, intentSet.intents, llm, deps.model)).briefs;
  // A fix that promotes a claim this product's own reviews contest gets flagged: fix the product or
  // soften the wording before putting it where Alexa reads it.
  const contested = new Set((proof?.claims ?? []).filter((c) => c.verdict === "contested").map((c) => c.intentId));
  for (const b of briefs) if (contested.has(b.intentId) && !b.flags.includes("contested_by_reviews")) b.flags.push("contested_by_reviews");

  return {
    listing,
    intentSet,
    grades,
    score,
    imageClaims: claims,
    coverage,
    hiddenAnswers,
    skippedImageIds: skipped,
    competitors: competitorResults,
    gaps,
    briefs,
    ...(proof && { proof }),
    usage,
    notes,
  };
}

/**
 * Promise vs proof is an extra: it must never fail the audit. Any error (a missing recording in
 * replay mode, a used-up quota, a bad review file) becomes a short note and the audit carries on
 * without it. The note gives a safe reason, never the raw error, which can hold paths or URLs.
 */
async function checkListingProof(
  listing: Listing,
  grades: Grade[],
  claims: ImageClaim[],
  coverage: ClaimMatch[],
  intentSet: IntentSet,
  deps: AuditDeps,
  llm: JsonModel,
  notes: string[],
  log: (message: string) => void,
): Promise<ProofRun | undefined> {
  if (listing.source === "serpapi") {
    // Live pages carry no review text, but they carry Amazon's review topics for this product.
    const insights = listing.meta.insights ?? [];
    if (insights.length === 0) {
      notes.push("This product has no review summary on Amazon yet, so promise vs proof wasn't checked.");
      return undefined;
    }
    try {
      const proof = await proofFromTopics(listingClaims(grades, intentSet.intents, claims, coverage), intentSet.intents, insights, llm, deps.model);
      log(`proof: ${proof.claims.length} claims matched to Amazon review topics`);
      return proof;
    } catch (err) {
      log(`proof skipped: ${(err as Error).message}`);
      notes.push(`Promise vs proof was skipped: ${safeReason(err)}.`);
      return undefined;
    }
  }
  if (!deps.reviews) return undefined;
  if (listing.source === "paste") {
    notes.push("Pasted listings come without reviews, so promise vs proof wasn't checked.");
    return undefined;
  }
  try {
    const saved = await deps.reviews.get(listing.source, listing.requestedAsin);
    if (!saved || saved.reviews.length === 0) {
      notes.push("No reviews are saved for this product, so promise vs proof wasn't checked.");
      return undefined;
    }
    if (saved.badLines > 0) notes.push(`${saved.badLines} saved review line(s) couldn't be read and were skipped.`);
    const proof = await checkProof(listingClaims(grades, intentSet.intents, claims, coverage), intentSet.intents, saved.reviews, llm, deps.model);
    log(`proof: ${proof.claims.length} claims checked against ${saved.reviews.length} reviews`);
    return proof;
  } catch (err) {
    log(`proof skipped: ${(err as Error).message}`);
    notes.push(`Promise vs proof was skipped: ${safeReason(err)}.`);
    return undefined;
  }
}

function safeReason(err: unknown): string {
  if (err instanceof QuotaExhaustedError) return "the model's daily quota is used up";
  if (err instanceof ProviderError) {
    return /No recorded LLM response/.test(err.message) ? "its model answers aren't recorded, and live model calls are off" : "the model call failed";
  }
  return "an internal error";
}

async function loadRaw(req: AuditRequest, deps: AuditDeps): Promise<RawListing | null> {
  if (req.source === "paste") {
    if (!req.paste?.title) throw new AuditError("A pasted listing needs at least a title", "bad_request");
    return { source: "paste", requestedAsin: req.asin, fetchedAt: new Date().toISOString(), data: req.paste };
  }
  return deps.listings.get(req.source, req.asin, { live: req.live ?? false });
}

/**
 * Given ASINs win. Live: top organic search results for the leaf category, falling back to the
 * page's related products when search returns nothing. Offline: saved listings in the same leaf
 * category. A brand's own other products are never competitors. A max of 0 looks for none.
 */
async function findCompetitors(req: AuditRequest, listing: Listing, raw: RawListing, deps: AuditDeps, notes: string[], max: number): Promise<Listing[]> {
  if (max <= 0) {
    notes.push("Competitors weren't compared in this quick check, so gaps are ranked without a comparison.");
    return [];
  }
  const source = req.source === "paste" ? "serpapi" : req.source;
  let candidates: string[] = req.competitors ?? [];

  if (candidates.length === 0 && req.live && source === "serpapi" && deps.search) {
    const query = productQuery(listing, leafCategory(listing) ?? "");
    candidates = pickCompetitors(await deps.search.search(query), [listing.asin, listing.requestedAsin], max + 2);
    if (candidates.length === 0) {
      candidates = ((raw.data as { related_asins?: string[] }).related_asins ?? []).slice(0, max + 2);
      notes.push(`Amazon search for "${query}" returned nothing, so competitors come from the page's related products.`);
    }
  }
  if (candidates.length === 0 && !req.live) {
    const leaf = leafCategory(listing);
    for (const asin of await deps.listings.saved(source)) {
      if (asin === req.asin) continue;
      const o = await deps.listings.get(source, asin);
      if (o && leafCategory(normalize(o)) === leaf) candidates.push(asin);
    }
  }

  const out: Listing[] = [];
  const offDepartment: Listing[] = [];
  const brand = listing.meta.brand?.toLowerCase();
  for (const asin of candidates) {
    if (out.length >= max) break;
    const r = await deps.listings.get(source, asin, { live: req.live ?? false });
    if (!r) continue;
    const l = normalize(r);
    if (brand && l.meta.brand?.toLowerCase() === brand) continue;
    if (l.asin === listing.asin) continue;
    // Same department only: a search for a vague word ("Sets") can return clothing for a BJJ gi.
    if (!sameDepartment(listing, l)) {
      offDepartment.push(l);
      continue;
    }
    // One listing per competing brand: two Sharpie variants would count Sharpie twice in
    // "N of M competitors answer it".
    const other = l.meta.brand?.toLowerCase();
    if (other && out.some((o) => o.meta.brand?.toLowerCase() === other)) continue;
    out.push(l);
  }
  if (out.length === 0 && offDepartment.length > 0) {
    notes.push("The competitors found sit in another Amazon department, so they're compared with caution.");
    return offDepartment.slice(0, max);
  }
  if (out.length === 0) notes.push("No competitors found, so gaps are ranked without a comparison.");
  return out;
}

/** Two listings are in the same department when their category paths start the same way. */
function sameDepartment(a: Listing, b: Listing): boolean {
  const x = a.meta.categories[0];
  const y = b.meta.categories[0];
  return !x || !y || x === y;
}

/** Mines a question set from Walmart reviews of this product type, saves it, or returns null. */
async function mineCategory(listing: Listing, id: string, name: string, deps: AuditDeps, llm: JsonModel, notes: string[]): Promise<IntentSet | null> {
  if (!deps.categoryReviews) return null;
  const fetchReviews = (q: string) =>
    deps.categoryReviews!.forQuery(q).catch((err: Error) => {
      notes.push(`Couldn't fetch reviews to mine questions for "${name}" (${err.message}).`);
      return null;
    });
  let query = productQuery(listing, name);
  let got = await fetchReviews(query);
  // Too few under the category name: try once more with the product's own words.
  const second = titleQuery(listing, name);
  if ((!got || got.reviews.length < MIN_MINE_REVIEWS) && second !== query) {
    const again = await fetchReviews(second);
    if (again && again.reviews.length > (got?.reviews.length ?? 0)) [query, got] = [second, again];
  }
  if (!got || got.reviews.length < MIN_MINE_REVIEWS) return null;
  // A few products with many reviews each (not hundreds of products), and store reviews run short,
  // so take more per product and allow shorter ones than the dataset sampler's defaults.
  const sample = { perProduct: 60, maxProducts: 10, minLength: 50 };
  const { intentSet: mined, report } = await mineIntents({ categoryId: id, categoryName: name, match: [name], version: "mined-live-1", reviews: got.reviews, sample }, llm, deps.model);
  if (mined.intents.length < 5) return null;
  const set: IntentSet = { ...mined, reviewSource: "walmart" };
  await deps.intentSets.save(set, `Mined from ${report.sampleSize} Walmart reviews of ${got.products.length} "${query}" products. Not yet reviewed by hand.`);
  notes.push(`The "${name}" questions were mined from ${report.sampleSize} Walmart reviews of ${got.products.length} similar products.`);
  return set;
}

/** Fewer reviews than this and the counts aren't worth weighting by. */
const MIN_MINE_REVIEWS = 40;

/**
 * What to search for, on Amazon (competitors) or Walmart (reviews). The leaf category says the
 * product type ("Cleaning Cloths"); a one-word leaf ("Sets", "Tables") is too vague, so the title's
 * first words are used instead.
 */
export function productQuery(listing: Listing, leaf: string): string {
  if (leaf.trim().split(/\s+/).length >= 2) return leaf;
  return titleQuery(listing, leaf);
}

/** The title's first few words, without the brand or bare numbers. */
export function titleQuery(listing: Listing, fallback: string): string {
  const brand = listing.meta.brand?.toLowerCase();
  const title = listing.fields.find((f) => f.kind === "title")?.text ?? fallback;
  const words = title.replace(/[^A-Za-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && w.toLowerCase() !== brand && !/^\d+$/.test(w));
  return words.slice(0, 5).join(" ") || fallback;
}

async function loadIntentSet(listing: Listing, competitors: Listing[], deps: AuditDeps, llm: JsonModel, notes: string[], mineReviews: boolean): Promise<IntentSet> {
  const found = resolveIntentSet(listing, await deps.intentSets.all());
  // A set built from review topics or estimated can be upgraded: when mining is allowed, try it.
  const upgrade = found && found.basis !== "mined" && mineReviews && deps.categoryReviews ? await mineCategory(listing, found.categoryId, found.categoryName, deps, llm, notes) : null;
  if (upgrade) return upgrade;
  if (found) {
    if (!found.reviewed) notes.push(`The "${found.categoryName}" questions haven't been reviewed by a person yet.`);
    if (found.basis === "insights") notes.push(`The "${found.categoryName}" questions come from Amazon's review topics, weighted by review mentions, not from reading reviews one by one.`);
    if (found.basis === "estimated") notes.push(`The "${found.categoryName}" questions are estimated, not mined from reviews, so every question weighs the same.`);
    return found;
  }
  const name = leafCategory(listing) ?? "Unknown";
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  // First choice: mine real reviews of this product type, the same way the curated sets were built.
  if (mineReviews && deps.categoryReviews) {
    const mined = await mineCategory(listing, id, name, deps, llm, notes);
    if (mined) return mined;
  }
  // Next: Amazon's review topics for this listing and its competitors, weighted by how many
  // reviews mention each. Estimating from listing text is the fallback when there are too few.
  const fromInsights = await insightIntents({ categoryId: id, categoryName: name, match: [name], version: "insights-1", listings: [listing, ...competitors] }, llm, deps.model);
  if (fromInsights) {
    const listings = [listing, ...competitors].filter((l) => (l.meta.insights?.length ?? 0) > 0).length;
    await deps.intentSets.save(fromInsights, `Built from Amazon review topics across ${listings} listing(s), ${fromInsights.sampleSize} review mentions. Not yet reviewed by hand.`);
    notes.push(`No question set existed for "${name}", so one was built from Amazon's review topics for this listing and ${listings - 1} competitor(s), weighted by ${fromInsights.sampleSize.toLocaleString()} review mentions.`);
    return fromInsights;
  }
  const set = await estimateIntents({ categoryId: id, categoryName: name, match: [name], version: "estimated-1", listings: [listing, ...competitors] }, llm, deps.model);
  await deps.intentSets.save(set, "Estimated from listings; no reviews were mined. Not yet reviewed by hand.");
  notes.push(`No question set existed for "${name}", so one was estimated from this listing and its competitors. Every question weighs the same.`);
  return set;
}

async function loadImageClaims(listing: Listing, deps: AuditDeps, vision: JsonModel | null, notes: string[]): Promise<{ claims: ImageClaim[]; skipped: string[] }> {
  const saved = await deps.imageClaims.get(listing.source, listing.requestedAsin);
  if (saved && saved.promptVersion === TRANSCRIBE_PROMPT_VERSION) {
    return { claims: collectClaims(listing, saved.modelOutput), skipped: ((saved as { skippedImageIds?: string[] }).skippedImageIds ?? []) };
  }
  if (!vision || !deps.images || listing.images.length === 0) {
    if (listing.images.length > 0) notes.push("Images weren't read for this audit, so hidden answers aren't checked.");
    return { claims: [], skipped: [] };
  }

  const images: ImageBytes[] = [];
  let failed = 0;
  for (const img of listing.images.slice(0, deps.maxImages ?? 16)) {
    const data = await deps.images.get(img.url).catch(() => null);
    if (data) images.push({ id: img.id, ...data });
    else failed++;
  }
  const t = await transcribeImages(listing, images, vision, deps.model);
  if (failed > 0) notes.push(`${failed} image(s) couldn't be downloaded.`);
  if (t.skippedImageIds.length) notes.push(`The model refused to read ${t.skippedImageIds.length} image(s): ${t.skippedImageIds.join(", ")}.`);
  // Only save a complete read. A partial one (network trouble) would stick and hide images forever.
  if (failed === 0) {
    await deps.imageClaims.save(listing.source, listing.requestedAsin, {
      promptVersion: TRANSCRIBE_PROMPT_VERSION,
      model: t.model,
      usage: t.usage,
      images: images.length,
      skippedImageIds: t.skippedImageIds,
      modelOutput: t.modelOutput,
    });
  }
  return { claims: t.claims, skipped: t.skippedImageIds };
}
