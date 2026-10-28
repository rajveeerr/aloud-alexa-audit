import { createHash } from "node:crypto";
import type { JsonModel } from "./llm";
import type { ReviewText } from "./mine";
import { cleanText } from "./normalize/text";
import type { BriefSource, ClaimMatch, Grade, ImageClaim, Intent } from "./types";

/**
 * Promise vs proof: does what the listing promises match what its buyers report?
 *   claims the listing makes (code) → this product's reviews about each claim (keywords, code)
 *   → a seeded random sample (code) → label each review (model, batched) → verify (code)
 *   → rates with Wilson intervals and a verdict (code).
 * The model only reads reviews and picks a label. Everything that becomes a number is code.
 */

/** Bump whenever the wording or schema changes. Recorded labels key on it. */
export const PROOF_PROMPT_VERSION = "proof-labels@2026-10-28.2";

/** Below this many matching reviews no rate is given: an interval over 20 reviews is too wide to say anything. */
export const MIN_EVIDENCE = 30;
/** Reviews labelled per claim. 150 gives a contradiction interval about ±5 points at 10%, for 1-2 requests. */
export const MAX_SAMPLE = 150;
/** Reviews per request. Reviews average 156 characters, so 100 fit easily in one prompt. */
export const LABEL_BATCH = 100;
/**
 * A claim is contested when, with 95% confidence, at least 1 in 20 reviewers who talk about it
 * say the opposite. Some complaints are normal for any product (a bad unit, the wrong paper, a
 * misread), so a handful alone shouldn't flag it; a lower bound of 5% means the complaints are
 * too many to be that noise. It's a judgment call, kept as one named constant so it's easy to argue.
 */
export const CONTESTED_LOWER_BOUND = 0.05;

export type ProofLabel = "supports" | "contradicts" | "mixed" | "unrelated";
const LABELS = new Set<ProofLabel>(["supports", "contradicts", "mixed", "unrelated"]);

/** A promise the listing makes about one claim-kind question, with where it says it. */
export type ListingClaim = { intentId: string; sources: BriefSource[] };

export type Rate = { rate: number; low: number; high: number };

export type ClaimProof = {
  intentId: string;
  /** The listing's own words for the claim (the first source). */
  claim: string;
  sources: BriefSource[];
  keywords: string[];
  /** This product's reviews that mention the claim's keywords. */
  matching: number;
  sampled: number;
  counts: Record<ProofLabel, number> & { unlabelled: number };
  /** Shares of the reviews that actually discuss the claim (supports + contradicts + mixed). */
  support?: Rate;
  contradiction?: Rate;
  mixed?: Rate;
  examples: { supports: string[]; contradicts: string[]; mixed: string[] };
  verdict: "backed" | "contested" | "not_enough_evidence";
  flags: ("bad_index" | "bad_label" | "duplicate_label" | "unlabelled_reviews")[];
};

export type ProofRun = {
  /** How many reviews were available for this product. */
  reviews: number;
  claims: ClaimProof[];
  modelOutputs: unknown[];
  usage: { inputTokens: number; outputTokens: number; requests: number };
};

/**
 * Hand-written search terms for the claims in our categories. Each term matches at the start of
 * a word, so "smudg" finds smudge, smudges and smudging. Written by hand because a few words decide
 * recall here: buyers say "smear" as often as "smudge", and "lefty" as often as "left-handed".
 * Words that appear in nearly every review of the category ("erase" on a dry-erase board, "ink" on
 * a pen) are left out on purpose, or the filter would keep everything.
 */
export const CLAIM_KEYWORDS: Record<string, string[]> = {
  // gel pens
  smudge: ["smudg", "smear"],
  smudge_left_handed: ["left hand", "lefthand", "lefty", "lefties", "leftie", "southpaw"],
  dry_time: ["quick dry", "fast dry", "dries quick", "dries fast", "dries so fast", "dries instant", "dries immediately", "dry quick", "dry fast", "dry time", "drying time", "to dry", "still wet"],
  ink_flow: ["skip", "clog", "blob", "glob", "flow", "consistent", "stopped writing", "stops writing"],
  longevity: ["ran out", "runs out", "run out", "last long", "lasts", "long lasting", "longevity", "dried up", "dries up", "dried out", "dries out", "ink life"],
  bleed_through: ["bleed", "bled", "show through", "shows through", "see through", "ghost", "feather"],
  water_resistance: ["waterproof", "water proof", "water resist", "gets wet", "got wet", "archival", "fade", "acid free"],
  leaking: ["leak", "blob", "glob", "burst", "exploded", "ink everywhere"],
  surface_compatibility: ["paper", "cardstock", "glossy", "photo", "journal", "notebook"],
  opacity: ["opaque", "dark paper", "black paper", "show up", "shows up", "colored paper"],
  durability: ["broke", "break", "crack", "sturdy", "durable", "flimsy", "fell apart", "falls apart", "cheaply made", "well made"],
  // dry-erase boards
  erasability_and_staining: ["erases", "erased", "erasing", "erasab", "to erase", "ghost", "stain", "residue", "wipes clean", "wipe clean", "wipes off", "wipe off", "comes off", "come off"],
  durability_and_sturdiness: ["sturdy", "durable", "flimsy", "warp", "bent", "bend", "dent", "broke", "crack", "solid"],
  portability_and_weight: ["lightweight", "light weight", "heavy", "portable", "carry", "weigh"],
  marker_performance: ["marker"],
  surface_smoothness_and_flatness: ["smooth", "flat", "bump", "warp", "wavy", "uneven", "dimple", "texture"],
  adhesive_installation: ["adhesive", "sticky", "stick", "tape", "velcro", "command strip", "fell off", "falls off", "peel"],
  // mechanical pencils
  lead_breakage_resistance: ["break", "broke", "snap"],
  smoothness: ["smooth", "scratch"],
  erasability: ["eraser", "erases", "erasing", "to erase"],
  jamming: ["jam", "stuck", "clog"],
  smudge_resistance: ["smudg", "smear"],
};

const STOPWORDS = new Set(["and", "the", "of", "or", "for", "with", "to", "in", "on", "is", "does", "it"]);

/**
 * The terms used to find reviews about a claim. Unknown intents (a new category) fall back to the
 * words of the intent id ("leak_proof" → leak, proof). The id is used rather than the question,
 * because questions bring in the category's common words ("ink", "pen", "board") that match
 * every review.
 */
export function claimKeywords(intent: Pick<Intent, "id">): string[] {
  const table = CLAIM_KEYWORDS[intent.id];
  if (table) return table;
  return intent.id.split("_").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Lowercase, and every run of non-letters and non-digits becomes one space, so "left-handed" reads "left handed". */
function plain(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** True when the review contains any of the terms at the start of a word. */
export function mentions(review: Pick<ReviewText, "title" | "text">, terms: string[]): boolean {
  const text = plain(`${review.title} ${review.text}`);
  return terms.some((t) => text.includes(` ${plain(t).trim()}`));
}

/**
 * A random sample that's the same on every run: reviews are ordered by a hash of the claim and the
 * review text, and the first `max` are taken. Seeding by claim means each claim gets its own sample.
 */
export function sampleForClaim<T extends Pick<ReviewText, "title" | "text">>(intentId: string, reviews: T[], max = MAX_SAMPLE): T[] {
  const key = (r: T) => createHash("sha1").update(`${intentId}\n${r.title}\n${r.text}`).digest("hex");
  return reviews
    .map((r) => ({ r, k: key(r) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, max)
    .map((x) => x.r);
}

/**
 * Wilson score interval for k successes in n trials, 95% by default. Used instead of the textbook
 * p ± 1.96·√(p(1-p)/n) because that one breaks down for small rates: at 2 of 60 it gives a lower
 * bound below zero, while Wilson stays inside 0..1 and is still honest about the uncertainty.
 */
export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n <= 0 || k < 0 || k > n) throw new Error(`wilson: need 0 <= k <= n and n > 0 (got k=${k}, n=${n})`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * Which claim-kind questions the listing makes a promise about, and where:
 * - text: the verified grade is answered or partial, so its quotes are real words from real fields;
 * - images: an image claim the coverage step linked to that question.
 * Spec and experience questions are left out: a tip size isn't a promise reviews can test, and an
 * experience question has no promise to test.
 */
export function listingClaims(grades: Grade[], intents: Intent[], imageClaims: ImageClaim[], coverage: ClaimMatch[]): ListingClaim[] {
  const claimById = new Map(imageClaims.map((c) => [c.id, c]));
  const out: ListingClaim[] = [];
  for (const intent of intents) {
    if (intent.kind !== "claim") continue;
    const sources: BriefSource[] = [];
    const grade = grades.find((g) => g.intentId === intent.id);
    if (grade && (grade.status === "answered" || grade.status === "partial")) {
      for (const q of grade.quotes) sources.push({ kind: "field", id: q.fieldId, text: q.text });
    }
    for (const m of coverage) {
      const c = m.intentId === intent.id ? claimById.get(m.claimId) : undefined;
      if (c && !sources.some((s) => s.text.toLowerCase() === c.text.toLowerCase())) sources.push({ kind: "image", id: c.imageIds.join(","), text: c.text });
    }
    if (sources.length > 0) out.push({ intentId: intent.id, sources });
  }
  return out;
}

const INSTRUCTIONS = `A product listing makes a promise on one topic. Below are buyer reviews of that same product, numbered.
Read the promise as a good answer to the topic's question. If the listing's words are indirect (a warranty
offered as a sign of durability, "smooth writing" for ink flow), judge against what they promise on the topic.

For each review, decide what the reviewer's own experience says about that promise:
- "supports": their experience matches the promise ("never smears", "still sturdy after a year").
- "contradicts": their experience goes against it ("smears all over my hand", "the barrel cracked in a week").
- "mixed": true only in some conditions or for some units ("doesn't smudge on regular paper but smears on glossy",
  "2 of 3 pens leaked").
- "unrelated": the review doesn't describe the product on this topic. General praise ("great pens!") is unrelated.
Judge from what each review says about the topic, not from its star rating or overall mood.
Return one item per review: {"i": its number, "label": one of the four}.`;

export const PROOF_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      i: { type: "INTEGER" },
      label: { type: "STRING", enum: ["supports", "contradicts", "mixed", "unrelated"] },
    },
    required: ["i", "label"],
  },
} as const;

/** One claim and its reviews per prompt, so the model never judges a claim without its evidence in view. */
export function buildProofPrompt(claim: ListingClaim, intent: Pick<Intent, "question">, reviews: Pick<ReviewText, "title" | "text">[], start: number): string {
  const said = claim.sources
    .slice(0, 3)
    .map((s) => `"${s.text}"`)
    .join("; ");
  // Review text arrives raw from the source, with "<br />" and "&#34;" in it.
  const list = reviews.map((r, k) => `[${start + k}] ${cleanText(`${r.title}. ${r.text}`)}`).join("\n");
  return `${INSTRUCTIONS}\n\nTOPIC: ${intent.question}\nTHE LISTING SAYS: ${said}\n\nREVIEWS\n${list}`;
}

/**
 * The trust step for labels. Keeps a label only when its index is inside this batch and the label is
 * one of the four; the first label for a review wins. A review the model skipped stays unlabelled
 * and isn't counted either way, so a lazy or garbled answer shrinks the evidence instead of
 * inventing it.
 */
export function verifyLabels(modelOutput: unknown, start: number, count: number): { labels: (ProofLabel | null)[]; flags: ClaimProof["flags"] } {
  const labels: (ProofLabel | null)[] = Array.from({ length: count }, () => null);
  const flags = new Set<ClaimProof["flags"][number]>();
  for (const item of Array.isArray(modelOutput) ? modelOutput : []) {
    const i = (item as { i?: unknown })?.i;
    const label = (item as { label?: unknown })?.label;
    if (typeof i !== "number" || !Number.isInteger(i) || i < start || i >= start + count) {
      flags.add("bad_index");
      continue;
    }
    if (typeof label !== "string" || !LABELS.has(label as ProofLabel)) {
      flags.add("bad_label");
      continue;
    }
    if (labels[i - start] !== null) {
      flags.add("duplicate_label");
      continue;
    }
    labels[i - start] = label as ProofLabel;
  }
  if (labels.some((l) => l === null)) flags.add("unlabelled_reviews");
  return { labels, flags: [...flags] };
}

/** Labels a list of reviews against one claim, in batches. Shared by the audit and the evals. */
export async function labelReviews(
  claim: ListingClaim,
  intent: Pick<Intent, "question">,
  reviews: Pick<ReviewText, "title" | "text">[],
  llm: JsonModel,
  model: string,
  batchSize = LABEL_BATCH,
): Promise<{ labels: (ProofLabel | null)[]; flags: ClaimProof["flags"]; modelOutputs: unknown[]; usage: ProofRun["usage"] }> {
  const labels: (ProofLabel | null)[] = [];
  const flags = new Set<ClaimProof["flags"][number]>();
  const modelOutputs: unknown[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  // Equal-sized batches (150 → 75 + 75, not 100 + 50) so no call gets a thin slice.
  const batches = Math.ceil(reviews.length / batchSize);
  const size = Math.ceil(reviews.length / Math.max(1, batches));
  for (let start = 0; start < reviews.length; start += size) {
    const batch = reviews.slice(start, start + size);
    const res = await llm.generateJson({
      model,
      promptVersion: PROOF_PROMPT_VERSION,
      parts: [{ text: buildProofPrompt(claim, intent, batch, start) }],
      schema: PROOF_SCHEMA,
      temperature: 0,
    });
    usage.requests++;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    modelOutputs.push(res.data);
    const checked = verifyLabels(res.data, start, batch.length);
    labels.push(...checked.labels);
    for (const f of checked.flags) flags.add(f);
  }
  return { labels, flags: [...flags], modelOutputs, usage };
}

const EXAMPLE_LENGTH = 220;

/**
 * A short example for the report. Long reviews often reach the claim late ("Love the colors...
 * but they smear"), so the snippet starts a little before the first keyword rather than at the top.
 * Display only: the model always sees the whole review.
 */
export function exampleText(r: Pick<ReviewText, "title" | "text">, keywords: string[]): string {
  const text = cleanText(`${r.title}. ${r.text}`);
  if (text.length <= EXAMPLE_LENGTH) return text;
  const lower = text.toLowerCase();
  const hits = keywords.map((k) => lower.search(new RegExp(`\\b${k.replace(/[^a-z0-9]+/g, "[^a-z0-9]+")}`))).filter((i) => i >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  const start = first + 80 > EXAMPLE_LENGTH ? Math.max(0, first - 60) : 0;
  const body = text.slice(start, start + EXAMPLE_LENGTH - 2).trim();
  return `${start > 0 ? "…" : ""}${body}${start + EXAMPLE_LENGTH - 2 < text.length ? "…" : ""}`;
}

/**
 * Counts and rates, in code. Rates are shares of the reviews that discuss the claim; "unrelated"
 * keyword hits (a "dries out" review found by a dry-time search) aren't evidence either way, so
 * they're left out of the denominator. If fewer than MIN_EVIDENCE reviews remain, no rate is given.
 * The verdict uses contradictions only: "mixed" means true in some conditions, which is a nuance
 * for the brief, not proof that the claim is false.
 */
export function summarize(
  claim: ListingClaim,
  keywords: string[],
  matching: number,
  sample: ReviewText[],
  labels: (ProofLabel | null)[],
  flags: ClaimProof["flags"],
): ClaimProof {
  const counts = { supports: 0, contradicts: 0, mixed: 0, unrelated: 0, unlabelled: 0 };
  const byLabel: Record<ProofLabel, ReviewText[]> = { supports: [], contradicts: [], mixed: [], unrelated: [] };
  sample.forEach((r, k) => {
    const l = labels[k] ?? null;
    if (l === null) counts.unlabelled++;
    else {
      counts[l]++;
      byLabel[l].push(r);
    }
  });
  // Most helpful first: the reviews other shoppers found useful are the ones worth showing.
  const pick = (list: ReviewText[]) =>
    [...list]
      .sort((a, b) => b.helpfulVotes - a.helpfulVotes)
      .slice(0, 3)
      .map((r) => exampleText(r, keywords));
  const base = {
    intentId: claim.intentId,
    claim: claim.sources[0]?.text ?? "",
    sources: claim.sources,
    keywords,
    matching,
    sampled: sample.length,
    counts,
    examples: { supports: pick(byLabel.supports), contradicts: pick(byLabel.contradicts), mixed: pick(byLabel.mixed) },
    flags,
  };

  const relevant = counts.supports + counts.contradicts + counts.mixed;
  if (matching < MIN_EVIDENCE || relevant < MIN_EVIDENCE) return { ...base, verdict: "not_enough_evidence" };
  const contradiction = wilson(counts.contradicts, relevant);
  return {
    ...base,
    support: wilson(counts.supports, relevant),
    contradiction,
    mixed: wilson(counts.mixed, relevant),
    verdict: contradiction.low >= CONTESTED_LOWER_BOUND ? "contested" : "backed",
  };
}

/**
 * Checks every claim the listing makes against this product's reviews. A claim with fewer than
 * MIN_EVIDENCE matching reviews costs nothing: no model call, verdict "not enough evidence".
 */
export async function checkProof(claims: ListingClaim[], intents: Intent[], reviews: ReviewText[], llm: JsonModel, model: string): Promise<ProofRun> {
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  const modelOutputs: unknown[] = [];
  const out: ClaimProof[] = [];
  for (const claim of claims) {
    const intent = intents.find((i) => i.id === claim.intentId);
    if (!intent) continue;
    const keywords = claimKeywords(intent);
    const matching = reviews.filter((r) => mentions(r, keywords));
    if (matching.length < MIN_EVIDENCE) {
      out.push(summarize(claim, keywords, matching.length, [], [], []));
      continue;
    }
    const sample = sampleForClaim(intent.id, matching);
    const run = await labelReviews(claim, intent, sample, llm, model);
    usage.requests += run.usage.requests;
    usage.inputTokens += run.usage.inputTokens;
    usage.outputTokens += run.usage.outputTokens;
    modelOutputs.push(...run.modelOutputs);
    out.push(summarize(claim, keywords, matching.length, sample, run.labels, run.flags));
  }
  return { reviews: reviews.length, claims: out, modelOutputs, usage };
}
