import type { Grade, GradeFlag, GradeStatus, Intent, Listing, Quote } from "../types";
import { quoteMatches } from "./match";
import { gradableIntents } from "./prompt";

const STATUSES = new Set<GradeStatus>(["answered", "partial", "missing", "contradicted", "not_applicable"]);

type ModelGrade = { intentId?: unknown; status?: unknown; quotes?: unknown; value?: unknown };

/**
 * The trust step. Runs on every model answer before anything is stored or shown:
 * - each quote must really be in the field it cites (or, failing that, in some other field);
 * - an answer with no surviving quote becomes "missing" and is flagged;
 * - a contradiction needs verified quotes from two different fields;
 * - "not_applicable" is only allowed for questions marked conditional;
 * - a conditional question the listing doesn't address at all (a sharpener on a pencil that has
 *   none) is set aside as not_applicable rather than counted as missing. It only counts when the
 *   listing talks about it.
 * Every intent gets exactly one grade, in intent order, whatever the model returned.
 */
export function verifyGrades(listing: Listing, intents: Intent[], modelOutput: unknown): Grade[] {
  const byIntent = new Map<string, ModelGrade>();
  for (const g of Array.isArray(modelOutput) ? (modelOutput as ModelGrade[]) : []) {
    if (typeof g?.intentId === "string" && !byIntent.has(g.intentId)) byIntent.set(g.intentId, g);
  }

  return gradableIntents(intents).map((intent) => {
    const g = byIntent.get(intent.id);
    const modelStatus = typeof g?.status === "string" && STATUSES.has(g.status as GradeStatus) ? (g.status as GradeStatus) : null;
    if (!g || !modelStatus) {
      return { intentId: intent.id, status: "missing", quotes: [], modelStatus: "missing", flags: ["not_graded"] };
    }

    const flags: GradeFlag[] = [];
    const quotes = modelStatus === "missing" || modelStatus === "not_applicable" ? [] : checkQuotes(listing, g.quotes, flags);
    const status = decideStatus(intent, modelStatus, quotes, flags);
    const value = typeof g.value === "string" && g.value.trim() && hasAnswer(status) ? g.value.trim() : undefined;

    return {
      intentId: intent.id,
      status,
      quotes: hasAnswer(status) ? quotes : [],
      ...(value && { value }),
      modelStatus,
      flags,
    };
  });
}

function hasAnswer(status: GradeStatus): boolean {
  return status === "answered" || status === "partial" || status === "contradicted";
}

function checkQuotes(listing: Listing, raw: unknown, flags: GradeFlag[]): Quote[] {
  const kept: Quote[] = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    const fieldId = typeof q?.fieldId === "string" ? q.fieldId : "";
    const text = typeof q?.text === "string" ? q.text.trim() : "";
    if (!text) continue;

    const cited = listing.fields.find((f) => f.id === fieldId);
    let found = cited && quoteMatches(text, cited.text) ? cited : undefined;
    if (!found) {
      // The words may be real but cited from the wrong field. Accept them from where they
      // actually are, and say so, rather than throwing away a true answer.
      found = listing.fields.find((f) => quoteMatches(text, f.text));
      if (found) flags.push("quote_field_corrected");
    }
    if (!found) {
      flags.push("quote_not_found");
      continue;
    }
    if (!kept.some((k) => k.fieldId === found.id && k.text === text)) kept.push({ fieldId: found.id, text });
  }
  return kept;
}

function decideStatus(intent: Intent, modelStatus: GradeStatus, quotes: Quote[], flags: GradeFlag[]): GradeStatus {
  switch (modelStatus) {
    case "missing":
      if (!intent.conditional) return "missing";
      flags.push("conditional_unaddressed");
      return "not_applicable";
    case "not_applicable":
      if (intent.conditional) return "not_applicable";
      flags.push("not_applicable_rejected");
      return "missing";
    case "answered":
    case "partial":
      if (quotes.length > 0) return modelStatus;
      flags.push("unverified_answer");
      if (!intent.conditional) return "missing";
      flags.push("conditional_unaddressed");
      return "not_applicable";
    case "contradicted": {
      const fieldsQuoted = new Set(quotes.map((q) => q.fieldId));
      if (fieldsQuoted.size >= 2) return "contradicted";
      // One side checks out, so the listing does give an answer; the conflict isn't proven.
      flags.push("unverified_contradiction");
      if (quotes.length > 0) return "answered";
      flags.push("unverified_answer");
      return "missing";
    }
  }
}
