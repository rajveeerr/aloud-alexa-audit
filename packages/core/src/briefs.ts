import { quoteMatches } from "./grade/match";
import type { JsonModel } from "./llm";
import type { Brief, BriefAction, BriefSource, Gap, Grade, ImageClaim, Intent, Listing } from "./types";

export const BRIEF_PROMPT_VERSION = "brief@2026-10-27.1";
export const FAITHFULNESS_PROMPT_VERSION = "faithfulness@2026-10-27.1";

/** Briefs are written for the top gaps only; a fix list nobody finishes helps nobody. */
export const MAX_BRIEFS = 8;

const INSTRUCTIONS = `You write fixes for an Amazon listing so it answers the questions shoppers ask.
For each gap you get the question, what the listing says now, and the brand's own data: its text fields and
claims printed in its images.

For each gap return:
- target: the field to change. An existing field id (like "bullet.2") to edit it, "new_bullet" to add one, or
  "attr.<name>" for an attribute.
- draft: the new or rewritten text, in the listing's voice, one bullet's length at most.
- sources: every piece of brand data the draft relies on, as {id, text}, with text copied exactly from that
  field or image claim.
- needsFromBrand: if the brand's data doesn't contain the fact, leave draft out and say what fact is needed.

Hard rules:
- Every fact in the draft must come from the brand's data. Never use competitors' facts or your own knowledge.
  If the brand never states a size, count or claim, ask for it in needsFromBrand instead of writing it.
- Competitor wording is shown only so you can see how others phrase it. Don't copy their facts.
- Keep claims the brand makes; don't add new ones ("best", "guaranteed").`;

export const BRIEF_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      intentId: { type: "STRING" },
      target: { type: "STRING" },
      draft: { type: "STRING" },
      sources: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { id: { type: "STRING" }, text: { type: "STRING" } },
          required: ["id", "text"],
        },
      },
      needsFromBrand: { type: "STRING" },
    },
    required: ["intentId", "target", "sources"],
  },
} as const;

export function buildBriefPrompt(listing: Listing, gaps: Gap[], grades: Grade[], claims: ImageClaim[], intents: Intent[]): string {
  const byId = new Map(intents.map((i) => [i.id, i]));
  const fields = listing.fields.map((f) => `[${f.id}] ${f.text}`).join("\n");
  const imageClaims = claims.length ? claims.map((c) => `[${c.id}] ${c.text} (in ${c.imageIds.join(", ")})`).join("\n") : "(none)";
  const list = gaps
    .map((gap) => {
      const intent = byId.get(gap.intentId)!;
      const now = grades.find((g) => g.intentId === gap.intentId)?.quotes.map((q) => `${q.fieldId}: "${q.text}"`).join("; ");
      const hidden = gap.hiddenClaims.length ? `\n  Brand already says this in images: ${gap.hiddenClaims.map((c) => c.id).join(", ")}` : "";
      const style = gap.competitorsAnswering[0] ? `\n  How a competitor phrases it (style only): "${gap.competitorsAnswering[0].quote.text}"` : "";
      return `- ${gap.intentId}: ${intent.question}\n  Rubric: ${intent.rubric}\n  Listing now: ${gap.status}${now ? ` (${now})` : ""}${hidden}${style}`;
    })
    .join("\n");
  return `${INSTRUCTIONS}\n\nBRAND TEXT FIELDS\n${fields}\n\nBRAND IMAGE CLAIMS\n${imageClaims}\n\nGAPS\n${list}`;
}

type ModelBrief = { intentId?: unknown; target?: unknown; draft?: unknown; sources?: unknown; needsFromBrand?: unknown };

/** Numbers like 0.5, 6, 145.9. Each one in a draft must appear in a cited source. */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

function validTarget(listing: Listing, target: string): boolean {
  return target === "new_bullet" || /^attr\.[a-z0-9_]+$/.test(target) || listing.fields.some((f) => f.id === target);
}

/**
 * The action comes from the data, not the model:
 * - a contradiction is never "fixed" by guessing; the brief asks the brand which value is right;
 * - an answer hidden in images becomes "move it into text", with the image claim as its source;
 * - otherwise a draft survives only if its sources are real and every number in it is sourced.
 */
export function verifyBriefs(listing: Listing, gaps: Gap[], grades: Grade[], claims: ImageClaim[], intents: Intent[], modelOutput: unknown): Brief[] {
  const byIntent = new Map<string, ModelBrief>();
  for (const b of Array.isArray(modelOutput) ? (modelOutput as ModelBrief[]) : []) {
    if (typeof b?.intentId === "string" && !byIntent.has(b.intentId)) byIntent.set(b.intentId, b);
  }
  const questions = new Map(intents.map((i) => [i.id, i.question]));
  const claimById = new Map(claims.map((c) => [c.id, c]));

  return gaps.map((gap) => {
    const question = questions.get(gap.intentId) ?? gap.intentId;
    const base = { intentId: gap.intentId, question, priority: gap.priority };

    if (gap.status === "contradicted") {
      const quotes = grades.find((g) => g.intentId === gap.intentId)?.quotes ?? [];
      return {
        ...base,
        action: "fix_contradiction" as const,
        target: quotes[0]?.fieldId ?? "new_bullet",
        sources: quotes.map((q) => ({ kind: "field" as const, id: q.fieldId, text: q.text })),
        needsFromBrand: `Which is right: ${quotes.map((q) => `"${q.text}" (${q.fieldId})`).join(" or ")}? Then make every field say the same.`,
        flags: [],
      };
    }

    const m = byIntent.get(gap.intentId);
    const flags: Brief["flags"] = [];
    if (!m) flags.push("not_drafted");

    const sources: BriefSource[] = [];
    for (const s of Array.isArray(m?.sources) ? m.sources : []) {
      const id = typeof s?.id === "string" ? s.id : "";
      const text = typeof s?.text === "string" ? s.text.trim() : "";
      const field = listing.fields.find((f) => f.id === id);
      const claim = claimById.get(id);
      if (field && quoteMatches(text, field.text)) sources.push({ kind: "field", id, text });
      else if (claim && quoteMatches(text, claim.text)) sources.push({ kind: "image", id, text });
      else flags.push("source_not_found");
    }
    // The hidden claim is verified data already; make sure it's cited even if the model didn't.
    for (const c of gap.hiddenClaims) {
      if (!sources.some((s) => s.id === c.id)) sources.push({ kind: "image", id: c.id, text: c.text });
    }

    let target = typeof m?.target === "string" ? m.target : "new_bullet";
    if (!validTarget(listing, target)) {
      flags.push("invalid_target");
      target = "new_bullet";
    }

    let draft = typeof m?.draft === "string" && m.draft.trim() ? m.draft.trim() : undefined;
    if (draft) {
      const sourced = sources.map((s) => s.text).join(" ");
      if (numbersIn(draft).some((n) => !numbersIn(sourced).includes(n))) {
        flags.push("unsourced_number");
        draft = undefined;
      }
    }
    if (draft && sources.length === 0) {
      flags.push("no_brand_source");
      draft = undefined;
    }
    // The brand's own image words are always a safe draft when the model gave none we can keep.
    if (!draft && gap.hiddenClaims[0]) draft = gap.hiddenClaims[0].text;

    const action: BriefAction = !draft ? "request_fact" : gap.hiddenClaims.length ? "move_from_image" : target === "new_bullet" ? "add_bullet" : "edit_field";
    const needs = typeof m?.needsFromBrand === "string" && m.needsFromBrand.trim() ? m.needsFromBrand.trim() : `The brand's answer to: ${question}`;

    return {
      ...base,
      action,
      target,
      ...(draft ? { draft } : { needsFromBrand: needs }),
      sources: draft ? sources : sources.filter((s) => s.kind === "image"),
      flags,
    };
  });
}

const FAITHFULNESS_INSTRUCTIONS = `You check drafted Amazon listing copy against the brand data it was written from.
For each draft, list every statement in the draft that its sources don't directly support: a new benefit,
a stronger claim, a number, a use case or a comparison that isn't in the sources. Rewording is fine;
adding meaning is not. Return an empty list when everything in the draft is supported.`;

export const FAITHFULNESS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { intentId: { type: "STRING" }, unsupported: { type: "ARRAY", items: { type: "STRING" } } },
    required: ["intentId", "unsupported"],
  },
} as const;

export function buildFaithfulnessPrompt(briefs: Brief[]): string {
  const items = briefs
    .filter((b) => b.draft)
    .map((b) => `- ${b.intentId}\n  Draft: "${b.draft}"\n  Sources: ${b.sources.map((s) => `"${s.text}"`).join("; ")}`)
    .join("\n");
  return `${FAITHFULNESS_INSTRUCTIONS}\n\nDRAFTS\n${items}`;
}

/**
 * Applies the judge's verdict. The judge can only make a brief safer: a draft with any
 * unsupported statement is replaced by the brand's exact image words when it came from an
 * image, and otherwise turned into a request for the fact. A wrong verdict costs one draft,
 * never adds a claim.
 */
export function applyFaithfulness(briefs: Brief[], gaps: Gap[], modelOutput: unknown): Brief[] {
  const verdicts = new Map<string, string[]>();
  for (const v of Array.isArray(modelOutput) ? modelOutput : []) {
    if (typeof v?.intentId !== "string" || !Array.isArray(v.unsupported)) continue;
    const list = v.unsupported.filter((x: unknown): x is string => typeof x === "string" && x.trim() !== "");
    verdicts.set(v.intentId, list);
  }
  return briefs.map((b) => {
    const unsupported = verdicts.get(b.intentId) ?? [];
    if (!b.draft || unsupported.length === 0) return b;
    const hidden = gaps.find((g) => g.intentId === b.intentId)?.hiddenClaims[0];
    const flags = [...b.flags, "unsupported_claim" as const];
    if (hidden && b.draft !== hidden.text) {
      return { ...b, draft: hidden.text, sources: b.sources.filter((s) => s.id === hidden.id), flags, rejectedStatements: unsupported };
    }
    const { draft: _dropped, ...rest } = b;
    const question = b.question.replace(/\?$/, "");
    return {
      ...rest,
      action: "request_fact" as const,
      needsFromBrand: `The brand's answer to "${question}". A drafted version went beyond what the listing says, so it was held back.`,
      flags,
      rejectedStatements: unsupported,
    };
  });
}

export type BriefRun = {
  briefs: Brief[];
  modelOutput: unknown;
  faithfulnessOutput: unknown;
  usage: { inputTokens: number; outputTokens: number };
  cached: boolean;
};

/** One request drafts every brief for the listing's top gaps; a second checks the drafts. */
export async function draftBriefs(
  listing: Listing,
  gaps: Gap[],
  grades: Grade[],
  claims: ImageClaim[],
  intents: Intent[],
  llm: JsonModel,
  model: string,
): Promise<BriefRun> {
  const top = gaps.slice(0, MAX_BRIEFS);
  // Contradictions don't need the model: the brief is a question to the brand.
  const toDraft = top.filter((g) => g.status !== "contradicted");
  const usage = { inputTokens: 0, outputTokens: 0 };
  let cached = true;
  let modelOutput: unknown = [];

  if (toDraft.length > 0) {
    const res = await llm.generateJson({
      model,
      promptVersion: BRIEF_PROMPT_VERSION,
      parts: [{ text: buildBriefPrompt(listing, toDraft, grades, claims, intents) }],
      schema: BRIEF_SCHEMA,
      temperature: 0,
    });
    modelOutput = res.data;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    cached &&= res.cached;
  }
  let briefs = verifyBriefs(listing, top, grades, claims, intents, modelOutput);

  let faithfulnessOutput: unknown = [];
  // Drafts that are exactly the brand's image words need no check.
  const toCheck = briefs.filter((b) => b.draft && !gaps.some((g) => g.intentId === b.intentId && g.hiddenClaims.some((c) => c.text === b.draft)));
  if (toCheck.length > 0) {
    const res = await llm.generateJson({
      model,
      promptVersion: FAITHFULNESS_PROMPT_VERSION,
      parts: [{ text: buildFaithfulnessPrompt(toCheck) }],
      schema: FAITHFULNESS_SCHEMA,
      temperature: 0,
    });
    faithfulnessOutput = res.data;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    cached &&= res.cached;
    briefs = applyFaithfulness(briefs, gaps, res.data);
  }
  return { briefs, modelOutput, faithfulnessOutput, usage, cached };
}
