import { quoteMatches } from "../grade/match";
import { gradableIntents } from "../grade/prompt";
import type { JsonModel } from "../llm";
import type { ClaimCoverage, ClaimMatch, ImageClaim, Intent, Listing, Quote } from "../types";

export const COVERAGE_PROMPT_VERSION = "coverage@2026-10-27.1";

const INSTRUCTIONS = `An Amazon listing makes some claims inside its images. For each image claim, decide whether the
listing's readable text already says the same thing, and which shopper question it answers.

coverage:
- "in_text": a text field states the same fact. Quote the words, copied exactly, with the field id.
- "partial": the text says part of it (e.g. text says "fine point", image says "0.5 mm fine point"). Quote that part.
- "image_only": no text field says it.
intentId: the id of the shopper question the claim answers, or leave it out if it answers none.
Judge only from the fields given. Don't use outside knowledge.`;

export const COVERAGE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      claimId: { type: "STRING" },
      coverage: { type: "STRING", enum: ["in_text", "partial", "image_only"] },
      quotes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { fieldId: { type: "STRING" }, text: { type: "STRING" } },
          required: ["fieldId", "text"],
        },
      },
      intentId: { type: "STRING" },
    },
    required: ["claimId", "coverage", "quotes"],
  },
} as const;

export function buildCoveragePrompt(listing: Listing, claims: ImageClaim[], intents: Intent[]): string {
  const fields = listing.fields.map((f) => `[${f.id}] ${f.text}`).join("\n");
  const questions = gradableIntents(intents)
    .map((i) => `- ${i.id}: ${i.question}`)
    .join("\n");
  const list = claims.map((c) => `- ${c.id}: ${c.text}`).join("\n");
  return `${INSTRUCTIONS}\n\nTEXT FIELDS\n${fields}\n\nSHOPPER QUESTIONS\n${questions}\n\nIMAGE CLAIMS\n${list}`;
}

/** Claims whose words already appear in a field don't need the model at all. */
export function matchInCode(listing: Listing, claim: ImageClaim): Quote | undefined {
  const field = listing.fields.find((f) => quoteMatches(claim.text, f.text));
  return field ? { fieldId: field.id, text: claim.text } : undefined;
}

type ModelMatch = { claimId?: unknown; coverage?: unknown; quotes?: unknown; intentId?: unknown };
const COVERAGES = new Set<ClaimCoverage>(["in_text", "partial", "image_only"]);

/**
 * Same idea as the grade verifier. "in_text" and "partial" must come with a quote that's really
 * in a field; if not, the model's opinion is kept but flagged `unverified_coverage`, and the claim
 * is treated as image_only. Callers then only report a hidden answer when the verified grade for
 * that question is also missing or partial, so a wrong "image_only" can't create a false finding
 * on its own.
 */
export function verifyCoverage(listing: Listing, claims: ImageClaim[], intents: Intent[], modelOutput: unknown): ClaimMatch[] {
  const known = new Set(gradableIntents(intents).map((i) => i.id));
  const byClaim = new Map<string, ModelMatch>();
  for (const m of Array.isArray(modelOutput) ? (modelOutput as ModelMatch[]) : []) {
    if (typeof m?.claimId === "string" && !byClaim.has(m.claimId)) byClaim.set(m.claimId, m);
  }

  return claims.map((claim) => {
    const m = byClaim.get(claim.id);
    const flags: ClaimMatch["flags"] = [];
    const intentId = typeof m?.intentId === "string" && m.intentId ? m.intentId : undefined;
    if (intentId && !known.has(intentId)) flags.push("unknown_intent");
    const intent = intentId && known.has(intentId) ? { intentId } : {};

    const inCode = matchInCode(listing, claim);
    if (inCode) return { claimId: claim.id, coverage: "in_text", quotes: [inCode], ...intent, flags };

    const said = typeof m?.coverage === "string" && COVERAGES.has(m.coverage as ClaimCoverage) ? (m.coverage as ClaimCoverage) : "image_only";
    if (said === "image_only") return { claimId: claim.id, coverage: "image_only", quotes: [], ...intent, flags };

    const quotes: Quote[] = [];
    for (const q of Array.isArray(m?.quotes) ? m.quotes : []) {
      const text = typeof q?.text === "string" ? q.text.trim() : "";
      const field = listing.fields.find((f) => f.id === q?.fieldId && quoteMatches(text, f.text)) ?? listing.fields.find((f) => quoteMatches(text, f.text));
      if (field) quotes.push({ fieldId: field.id, text });
      else flags.push("quote_not_found");
    }
    if (quotes.length === 0) {
      flags.push("unverified_coverage");
      return { claimId: claim.id, coverage: "image_only", quotes: [], ...intent, flags };
    }
    return { claimId: claim.id, coverage: said, quotes, ...intent, flags };
  });
}

export type CoverageRun = {
  matches: ClaimMatch[];
  modelOutput: unknown;
  usage: { inputTokens: number; outputTokens: number };
  cached: boolean;
};

/** One text request for all of a listing's image claims. */
export async function checkCoverage(
  listing: Listing,
  claims: ImageClaim[],
  intents: Intent[],
  llm: JsonModel,
  model: string,
): Promise<CoverageRun> {
  if (claims.length === 0) return { matches: [], modelOutput: [], usage: { inputTokens: 0, outputTokens: 0 }, cached: true };
  const res = await llm.generateJson({
    model,
    promptVersion: COVERAGE_PROMPT_VERSION,
    parts: [{ text: buildCoveragePrompt(listing, claims, intents) }],
    schema: COVERAGE_SCHEMA,
    temperature: 0,
  });
  return { matches: verifyCoverage(listing, claims, intents, res.data), modelOutput: res.data, usage: res.usage, cached: res.cached };
}
