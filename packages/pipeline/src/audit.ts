import {
  checkCoverage,
  checkProof,
  listingClaims,
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

  const intentSet = await loadIntentSet(listing, competitors, deps, llm, notes);
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
  if (!deps.reviews) return undefined;
  if (listing.source === "serpapi") {
    notes.push("Live listings come without review text, so promise vs proof wasn't checked.");
    return undefined;
  }
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
    const query = leafCategory(listing) ?? listing.fields.find((f) => f.id === "title")?.text.split(",")[0] ?? "";
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
  const brand = listing.meta.brand?.toLowerCase();
  for (const asin of candidates) {
    if (out.length >= max) break;
    const r = await deps.listings.get(source, asin, { live: req.live ?? false });
    if (!r) continue;
    const l = normalize(r);
    if (brand && l.meta.brand?.toLowerCase() === brand) continue;
    if (l.asin === listing.asin) continue;
    // One listing per competing brand: two Sharpie variants would count Sharpie twice in
    // "N of M competitors answer it".
    const other = l.meta.brand?.toLowerCase();
    if (other && out.some((o) => o.meta.brand?.toLowerCase() === other)) continue;
    out.push(l);
  }
  if (out.length === 0) notes.push("No competitors found, so gaps are ranked without a comparison.");
  return out;
}

async function loadIntentSet(listing: Listing, competitors: Listing[], deps: AuditDeps, llm: JsonModel, notes: string[]): Promise<IntentSet> {
  const found = resolveIntentSet(listing, await deps.intentSets.all());
  if (found) {
    if (!found.reviewed) notes.push(`The "${found.categoryName}" questions haven't been reviewed by a person yet.`);
    if (found.basis === "estimated") notes.push(`The "${found.categoryName}" questions are estimated, not mined from reviews, so every question weighs the same.`);
    return found;
  }
  const name = leafCategory(listing) ?? "Unknown";
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
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
