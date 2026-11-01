/**
 * Reading an audit report the way the CLI does (apps/cli/src/audit.ts): same sort order,
 * same basis wording, plus the plain-language labels the UI shows for statuses, actions and flags.
 */
import type { AuditReport } from "@aloud/contracts";
import { pointsIfAnswered, scoreBand, type ScoreBand } from "@aloud/core/score";

export type Report = AuditReport;
export type Grade = Report["grades"][number];
export type Intent = Report["intentSet"]["intents"][number];
export type Brief = Report["briefs"][number];
export type Gap = Report["gaps"][number];
export type Field = Report["listing"]["fields"][number];
export type ImageClaim = Report["imageClaims"][number];
export type GradeStatus = Grade["status"];

export function indexReport(r: Report) {
  return {
    intents: new Map(r.intentSet.intents.map((i) => [i.id, i])),
    fields: new Map(r.listing.fields.map((f) => [f.id, f])),
    images: new Map(r.listing.images.map((i) => [i.id, i])),
    claims: new Map(r.imageClaims.map((c) => [c.id, c])),
  };
}
export type ReportIndex = ReturnType<typeof indexReport>;

/** Points the score would gain if each counted question were fully answered. */
export const fixGains = (r: Report) => pointsIfAnswered(r.grades, r.intentSet.intents);

export const BAND: Record<ScoreBand, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-answered-bg text-answered" },
  partly_ready: { label: "Partly ready", tone: "bg-partial-bg text-partial" },
  not_ready: { label: "Not ready", tone: "bg-missing-bg text-missing" },
};
export { scoreBand };

export const isEstimated = (r: Report) => r.intentSet.basis === "estimated";

export function titleOf(r: Report): string {
  return r.listing.fields.find((f) => f.id === "title")?.text ?? r.listing.asin;
}

export function basisLabel(r: Report): string {
  const s = r.intentSet;
  if (s.basis === "estimated") return "Estimated questions (no reviews mined), equal weights";
  if (s.basis === "insights") return `Questions from Amazon review topics, ${s.sampleSize.toLocaleString()} review mentions`;
  if (s.reviewSource === "walmart") return `Questions mined from ${s.sampleSize.toLocaleString()} Walmart reviews of this product type`;
  return `Questions mined from ${s.sampleSize.toLocaleString()} reviews`;
}

/**
 * How much demand a question carries, said the way its numbers were counted: mined sets count
 * shoppers who ask, review-topic sets count reviews that mention it.
 */
export function demand(r: Report, n: number, form: "full" | "short" = "full"): string {
  const v = n.toLocaleString();
  if (r.intentSet.basis === "insights") return form === "full" ? `${v} reviews mention it` : `${v} mentions`;
  return form === "full" ? `${v} shoppers ask` : `${v} asking`;
}

const ORDER: GradeStatus[] = ["contradicted", "missing", "partial", "answered", "not_applicable"];

/** Worst first, then most asked: the order a seller should read them in. */
export function sortGrades(grades: Grade[], intents: Map<string, Intent>): Grade[] {
  return [...grades].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (intents.get(b.intentId)?.frequency ?? 0) - (intents.get(a.intentId)?.frequency ?? 0),
  );
}

export const STATUS_LABEL: Record<GradeStatus, string> = {
  answered: "Answered",
  partial: "Partly answered",
  missing: "Not answered",
  contradicted: "Contradicted",
  not_applicable: "Doesn't apply",
};

export const GRADE_FLAG_TEXT: Record<Grade["flags"][number], string> = {
  quote_not_found: "The grader quoted text that isn't on the listing, so that quote was dropped.",
  quote_field_corrected: "The quote is real, but the grader named the wrong field. It now points to the field the text is actually in.",
  unverified_answer: "The grader said this was answered, but none of its quotes could be found on the listing, so it counts as not answered.",
  unverified_contradiction: "The grader saw a contradiction it couldn't back with two real quotes, so it isn't counted as one.",
  not_applicable_rejected: "The grader said this question doesn't apply, but the rules say it always does, so it was graded normally.",
  conditional_unaddressed: "This question only matters for some products, and the listing doesn't mention it at all, so it's left out of the score.",
  not_graded: "The grader didn't return a result for this question.",
};

export const BRIEF_FLAG_TEXT: Record<Brief["flags"][number], string> = {
  source_not_found: "A source the draft cited couldn't be found in the listing.",
  unsourced_number: "The draft had a number the brand never gave, so it was held back.",
  invalid_target: "The suggested field doesn't exist, so the target was reset.",
  no_brand_source: "Nothing in the brand's own content answers this yet.",
  not_drafted: "No draft was written for this one.",
  unsupported_claim: "The draft added claims the brand never made, so it was held back.",
  off_question: "The draft didn't answer the question, so it was held back.",
  repeats_field: "The draft only repeated an existing field, so it was dropped.",
  contested_by_reviews: "This product's reviews contest this claim. Fix the product or soften the wording before putting it where Alexa reads it.",
};

export const ACTION_LABEL: Record<Brief["action"], string> = {
  fix_contradiction: "Fix a contradiction",
  move_from_image: "Move from image into text",
  edit_field: "Rewrite an existing field",
  add_bullet: "Add a bullet",
  request_fact: "Ask the brand for a fact",
};

export function targetLabel(target: string): string {
  if (target === "new_bullet") return "A new bullet";
  if (target.startsWith("attr.")) return `Attribute: ${target.slice(5).replace(/_/g, " ")}`;
  return fieldLabel(target);
}

/** "bullet.2" → "Bullet 2", "attr.line_size" → "line size", "aplus.3" → "A+ module 3". */
export function fieldLabel(id: string): string {
  const [kind, ...rest] = id.split(".");
  const n = rest.join(".");
  switch (kind) {
    case "title":
      return "Title";
    case "bullet":
      return `Bullet ${n}`;
    case "description":
      return `Description ${n}`;
    case "aplus":
      return `A+ module ${n}`;
    case "attr":
      return n.replace(/_/g, " ");
    default:
      return id;
  }
}

/** Where a quote sits, for people: "Bullet 2", "Line size", "Image 8". The raw id stays in the DOM for tooltips. */
export function placeLabel(id: string): string {
  if (id.startsWith("img.")) return `Image ${id.slice(4)}`;
  const label = fieldLabel(id);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** ["img.2", "img.11"] → "images 2 and 11". */
export function imagesLabel(ids: string[]): string {
  const n = ids.map((i) => i.replace(/^img\./, ""));
  if (n.length === 0) return "";
  if (n.length === 1) return `image ${n[0]}`;
  return `images ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** Ids stay as the pipeline wrote them ("img.8"), so a brief and the report name the same image. */
export function imageKindLabel(kind?: "gallery" | "aplus"): string {
  return kind === "aplus" ? "A+ image" : "Gallery image";
}

/**
 * How many competitors answer a question, fully or partly, out of those it applies to.
 * Same rule as the API's widget view, so the report and the widget agree.
 */
export function competitorCounts(r: Pick<Report, "competitors">, intentId: string) {
  let competitors = 0;
  let competitorsAnswering = 0;
  let partly = 0;
  for (const c of r.competitors) {
    const g = c.grades.find((x) => x.intentId === intentId);
    if (!g || g.status === "not_applicable") continue;
    competitors++;
    if (g.status === "answered" || g.status === "partial") competitorsAnswering++;
    if (g.status === "partial") partly++;
  }
  return { competitorsAnswering, competitors, partly };
}

/** "4 of 4 competitors answer it (1 partly)": counts, never a weighted percentage. */
export function countsLabel(c: { competitorsAnswering: number; competitors: number; partly?: number }): string {
  if (c.competitors === 0) return "no competitors compared";
  const partly = c.partly ? ` (${c.partly} partly)` : "";
  return `${c.competitorsAnswering} of ${c.competitors} competitor${c.competitors === 1 ? "" : "s"} ${c.competitorsAnswering === 1 && c.competitors > 1 ? "answers" : "answer"} it${partly}`;
}
