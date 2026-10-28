import { createHash } from "node:crypto";
import type { JsonModel } from "./llm";
import { toKey } from "./normalize/text";
import type { Intent, IntentKind, IntentSet, Listing } from "./types";

/**
 * Builds a category's question set from real reviews:
 *   sample (code) → extract needs (model, batched) → group and tag (model) → count (code).
 * Runs once per category; the result is cached and should be reviewed by a person.
 */

export const EXTRACT_PROMPT_VERSION = "extract-needs@2026-10-27.1";
export const CLUSTER_PROMPT_VERSION = "cluster-needs@2026-10-27.1";
export const ESTIMATE_PROMPT_VERSION = "estimate-intents@2026-10-27.1";

export type ReviewText = { asin: string; title: string; text: string; helpfulVotes: number; rating?: number };

export type SampleOptions = {
  /** Reviews taken from each product, most helpful first. */
  perProduct?: number;
  /** Products taken, most-reviewed first. */
  maxProducts?: number;
  minLength?: number;
  maxLength?: number;
  /** Leave these out, e.g. the product being audited, so it isn't graded against itself. */
  excludeAsins?: string[];
};

/**
 * Spread across many products so one bestseller doesn't decide the questions, and biased to
 * helpful reviews because those tend to discuss the product rather than delivery.
 * Deterministic: same input, same sample.
 */
export function sampleReviews(reviews: ReviewText[], opts: SampleOptions = {}): ReviewText[] {
  const perProduct = opts.perProduct ?? 10;
  const maxProducts = opts.maxProducts ?? 60;
  const minLength = opts.minLength ?? 120;
  const maxLength = opts.maxLength ?? 900;
  const exclude = new Set(opts.excludeAsins ?? []);

  const byProduct = new Map<string, ReviewText[]>();
  for (const r of reviews) {
    if (exclude.has(r.asin) || r.text.length < minLength || r.text.length > maxLength) continue;
    const list = byProduct.get(r.asin) ?? [];
    list.push(r);
    byProduct.set(r.asin, list);
  }
  const stable = (r: ReviewText) => createHash("sha1").update(r.text).digest("hex");
  return [...byProduct.entries()]
    .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))
    .slice(0, maxProducts)
    .flatMap(([, list]) => [...list].sort((a, b) => b.helpfulVotes - a.helpfulVotes || (stable(a) < stable(b) ? -1 : 1)).slice(0, perProduct));
}

const EXTRACT_INSTRUCTIONS = (category: string) => `Each item is a buyer's review of a product in the category "${category}".
For each review, list the product facts a shopper would want answered before buying, as short snake_case needs
(for example: tip_size, refillable, dry_time, fits_small_car_boot, dishwasher_safe).
Only include facts the review shows someone cared about. Use the same need name for the same idea across reviews.
Leave out price, value for money, delivery, seller service and packaging damage: a listing can't answer those.
Return an empty list for a review with no such need.`;

const EXTRACT_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { i: { type: "INTEGER" }, needs: { type: "ARRAY", items: { type: "STRING" } } },
    required: ["i", "needs"],
  },
} as const;

const CLUSTER_INSTRUCTIONS = (category: string) => `These are information needs shoppers showed in reviews of "${category}" products,
with how many reviews showed each. Group them into 15 to 30 distinct shopper questions.

For each question return:
- id: a short snake_case name.
- question: one plain question a shopper would ask.
- kind: "spec" (a fact a listing can simply state: size, material, count, compatibility),
  "claim" (a performance promise a listing can make and reviews can confirm or deny: leak-proof, quick dry),
  or "experience" (only buyers can judge: how comfortable, how nice it feels).
- rubric: one line, "answered: ... partial: ...", saying what listing text counts.
- conditional: true only if the question applies to some products in the category but not most.
- members: the exact need names it covers, copied from the list.

Keep a narrower question separate from a broader one when shoppers clearly ask it on its own
(for example "smudges for left-handed writers" apart from "smudges"). Drop needs a listing can't answer.`;

const CLUSTER_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      question: { type: "STRING" },
      kind: { type: "STRING", enum: ["spec", "claim", "experience"] },
      rubric: { type: "STRING" },
      conditional: { type: "BOOLEAN" },
      members: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["id", "question", "kind", "rubric", "members"],
  },
} as const;

const KINDS = new Set<IntentKind>(["spec", "claim", "experience"]);

export type MineReport = {
  sampleSize: number;
  distinctNeeds: number;
  /** Share of reviews with at least one need that ended up in some question. */
  coverage: number;
  /** Needs the grouping left out, most common first. Worth a look when reviewing. */
  unassigned: [string, number][];
  /** Questions dropped for being too rare or empty after checking members. */
  dropped: string[];
  usage: { inputTokens: number; outputTokens: number; requests: number };
};

export type MineInput = {
  categoryId: string;
  /** Passed in, not read from the clock, so the same input always gives the same set. */
  version: string;
  categoryName: string;
  match: string[];
  reviews: ReviewText[];
  sample?: SampleOptions;
  batchSize?: number;
  /** A question needs at least this many reviews, and at least 0.5% of the sample. */
  minFrequency?: number;
};

export async function mineIntents(input: MineInput, llm: JsonModel, model: string): Promise<{ intentSet: IntentSet; report: MineReport }> {
  const sample = sampleReviews(input.reviews, input.sample);
  const batchSize = input.batchSize ?? 150;
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0 };

  // needsByReview[i] = the set of needs review i showed. Counting reviews, not mentions,
  // means a review that says "smudges" three times counts once.
  const needsByReview: Set<string>[] = sample.map(() => new Set());
  for (let start = 0; start < sample.length; start += batchSize) {
    const batch = sample.slice(start, start + batchSize);
    const text = batch.map((r, k) => `[${start + k}] ${r.title}. ${r.text}`.replace(/\s+/g, " ")).join("\n");
    const res = await llm.generateJson<{ i: number; needs: string[] }[]>({
      model,
      promptVersion: `${EXTRACT_PROMPT_VERSION}+${input.categoryId}`,
      parts: [{ text: `${EXTRACT_INSTRUCTIONS(input.categoryName)}\n\n${text}` }],
      schema: EXTRACT_SCHEMA,
      temperature: 0,
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.requests++;
    for (const row of Array.isArray(res.data) ? res.data : []) {
      // Ignore indexes outside this batch: the model sometimes renumbers.
      if (!Number.isInteger(row?.i) || row.i < start || row.i >= start + batch.length) continue;
      for (const n of Array.isArray(row.needs) ? row.needs : []) {
        const key = typeof n === "string" ? toKey(n) : "";
        if (key) needsByReview[row.i]!.add(key);
      }
    }
  }

  const needCounts = new Map<string, number>();
  for (const set of needsByReview) for (const n of set) needCounts.set(n, (needCounts.get(n) ?? 0) + 1);
  const ranked = [...needCounts.entries()].sort((a, b) => b[1] - a[1]);

  const res = await llm.generateJson<{ id: string; question: string; kind: string; rubric: string; conditional?: boolean; members: string[] }[]>({
    model,
    promptVersion: `${CLUSTER_PROMPT_VERSION}+${input.categoryId}`,
    parts: [{ text: `${CLUSTER_INSTRUCTIONS(input.categoryName)}\n\n${ranked.slice(0, 400).map(([n, c]) => `${n} (${c})`).join("\n")}` }],
    schema: CLUSTER_SCHEMA,
    temperature: 0,
  });
  usage.inputTokens += res.usage.inputTokens;
  usage.outputTokens += res.usage.outputTokens;
  usage.requests++;

  const minFrequency = Math.max(input.minFrequency ?? 3, Math.ceil(sample.length * 0.005));
  const intents: Intent[] = [];
  const assigned = new Set<string>();
  const dropped: string[] = [];
  const usedIds = new Set<string>();

  for (const c of Array.isArray(res.data) ? res.data : []) {
    const id = toKey(typeof c?.id === "string" ? c.id : "");
    if (!id || usedIds.has(id) || !KINDS.has(c.kind as IntentKind)) continue;
    // Only real, not-yet-used needs count. A need claimed by two questions goes to the first.
    const members = (Array.isArray(c.members) ? c.members : []).map((m) => toKey(String(m))).filter((m) => needCounts.has(m) && !assigned.has(m));
    const frequency = needsByReview.filter((set) => members.some((m) => set.has(m))).length;
    if (frequency < minFrequency) {
      dropped.push(id);
      continue;
    }
    members.forEach((m) => assigned.add(m));
    usedIds.add(id);
    intents.push({
      id,
      kind: c.kind as IntentKind,
      question: String(c.question ?? "").trim(),
      rubric: String(c.rubric ?? "").trim(),
      frequency,
      ...(c.conditional === true && { conditional: true }),
    });
  }
  intents.sort((a, b) => b.frequency - a.frequency);

  const withNeeds = needsByReview.filter((s) => s.size > 0);
  const covered = withNeeds.filter((s) => [...s].some((n) => assigned.has(n))).length;

  return {
    intentSet: {
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      match: input.match,
      version: input.version,
      basis: "mined",
      reviewed: false,
      sampleSize: sample.length,
      intents,
    },
    report: {
      sampleSize: sample.length,
      distinctNeeds: needCounts.size,
      coverage: withNeeds.length ? Math.round((100 * covered) / withNeeds.length) / 100 : 0,
      unassigned: ranked.filter(([n]) => !assigned.has(n)).slice(0, 20),
      dropped,
      usage,
    },
  };
}

const ESTIMATE_INSTRUCTIONS = (category: string) => `No reviews are available for the category "${category}".
From the listings below, propose the 15 to 25 questions shoppers most often need answered before buying a
product of this kind. Use the same fields as a mined question set: id (snake_case), question, kind
("spec", "claim" or "experience"), rubric ("answered: ... partial: ..."), conditional (true only if it applies
to some products in the category, not most). Base questions on what this kind of product is used for, not on
what these particular listings happen to say.`;

/**
 * Fallback when a category has no reviews to mine. The questions are a guess, so every
 * frequency is 1 (no question outweighs another) and the set is marked "estimated".
 */
export async function estimateIntents(
  input: { categoryId: string; categoryName: string; match: string[]; version: string; listings: Listing[] },
  llm: JsonModel,
  model: string,
): Promise<IntentSet> {
  const sample = input.listings
    .slice(0, 5)
    .map((l) => l.fields.filter((f) => f.kind === "title" || f.kind === "bullet").slice(0, 4).map((f) => f.text).join(" | "))
    .join("\n");
  const res = await llm.generateJson<{ id: string; question: string; kind: string; rubric: string; conditional?: boolean }[]>({
    model,
    promptVersion: `${ESTIMATE_PROMPT_VERSION}+${input.categoryId}`,
    parts: [{ text: `${ESTIMATE_INSTRUCTIONS(input.categoryName)}\n\nLISTINGS\n${sample}` }],
    schema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          question: { type: "STRING" },
          kind: { type: "STRING", enum: ["spec", "claim", "experience"] },
          rubric: { type: "STRING" },
          conditional: { type: "BOOLEAN" },
        },
        required: ["id", "question", "kind", "rubric"],
      },
    },
    temperature: 0,
  });
  const seen = new Set<string>();
  const intents: Intent[] = [];
  for (const c of Array.isArray(res.data) ? res.data : []) {
    const id = toKey(typeof c?.id === "string" ? c.id : "");
    if (!id || seen.has(id) || !KINDS.has(c.kind as IntentKind)) continue;
    seen.add(id);
    intents.push({ id, kind: c.kind as IntentKind, question: String(c.question).trim(), rubric: String(c.rubric).trim(), frequency: 1, ...(c.conditional === true && { conditional: true }) });
  }
  return {
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    match: input.match,
    version: input.version,
    basis: "estimated",
    reviewed: false,
    sampleSize: 0,
    intents,
  };
}
