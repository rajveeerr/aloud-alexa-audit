import type { Intent, Listing } from "../types";

/** Bump whenever the wording, examples or schema change. Cached grades key on it. */
export const GRADE_PROMPT_VERSION = "grade@2026-10-27.1";

const INSTRUCTIONS = `You check whether an Amazon listing answers the questions shoppers ask about this kind of product.
You get the listing as numbered fields, then the questions. Each question has a rubric saying what counts.

For every question, return one grade:
- "answered": the listing states the answer. Quote the exact words.
- "partial": the listing gives part of the answer, as the rubric describes. Quote it.
- "missing": the listing doesn't say. No quotes.
- "contradicted": two fields give different answers to the same question. Quote both, from their two fields.
- "not_applicable": only allowed when the question is marked [only some products] and clearly doesn't apply to this product.

Rules:
- Quotes must be copied word for word from one field, with that field's id. Don't fix spelling, don't join two fields, don't paraphrase.
- Keep each quote short: the words that answer the question, not the whole field.
- Only use what the listing says. Don't use what you know about the brand or product.
- An attribute counts. "Closure type: Retractable" answers whether the pen is retractable.
- "value" is the answer in the listing's words, e.g. "0.5 mm". Leave it out when missing.

Examples (from other listings):
Question: What is the tip size or line width? Rubric: answered = a size in mm; partial = only fine, medium or bold.
  Field [title] "Gel Pens, Fine Point, Black, 10 Pack" gives
  {"intentId":"tip_size","status":"partial","quotes":[{"fieldId":"title","text":"Fine Point"}],"value":"Fine"}
Question: How many pens and which ink colors are in the pack?
  Fields [title] "Gel Pens, 6 Count" and [description.1] "Includes 4 pens in black ink" give
  {"intentId":"pack_contents","status":"contradicted","quotes":[{"fieldId":"title","text":"6 Count"},{"fieldId":"description.1","text":"Includes 4 pens"}]}
Question: Is the ink waterproof, fade-resistant or archival?
  A listing that never mentions water, fading or archival ink gives
  {"intentId":"water_resistance","status":"missing","quotes":[]}`;

export const GRADE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      intentId: { type: "STRING" },
      status: { type: "STRING", enum: ["answered", "partial", "missing", "contradicted", "not_applicable"] },
      quotes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { fieldId: { type: "STRING" }, text: { type: "STRING" } },
          required: ["fieldId", "text"],
        },
      },
      value: { type: "STRING" },
    },
    required: ["intentId", "status", "quotes"],
  },
} as const;

/**
 * Experience questions aren't sent: no listing can prove how smooth a pen feels, so they don't
 * count toward the score and grading them would only cost tokens.
 */
export function gradableIntents(intents: Intent[]): Intent[] {
  return intents.filter((i) => i.kind !== "experience");
}

export function buildGradePrompt(listing: Listing, intents: Intent[]): string {
  const fields = listing.fields.map((f) => `[${f.id}] ${f.text}`).join("\n");
  const questions = gradableIntents(intents)
    .map((i) => `- ${i.id}: ${i.question}${i.conditional ? " [only some products]" : ""} Rubric: ${i.rubric}`)
    .join("\n");
  return `${INSTRUCTIONS}\n\nLISTING FIELDS\n${fields}\n\nQUESTIONS\n${questions}\n\nReturn one grade per question, in the same order.`;
}
