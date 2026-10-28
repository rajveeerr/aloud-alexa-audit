/**
 * The eval harness: replays recorded model answers and scores them against hand labels.
 * Nothing here calls a model unless the caller passes a recording client (`run.ts --record`),
 * and that's only for the proof labels; grades come from the audit recordings in fixtures/llm.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GRADE_PROMPT_VERSION,
  PROOF_PROMPT_VERSION,
  gradeListing,
  labelReviews,
  normalize,
  resolveIntentSet,
  type GradeStatus,
  type IntentSet,
  type JsonModel,
  type JsonRequest,
  type ProofLabel,
} from "@answerable/core";
import { fsStores, runAudit } from "@answerable/pipeline";

export const ROOT = join(import.meta.dir, "..");
export const FIXTURES = join(ROOT, "fixtures");
export const MODEL = "gemini-3.5-flash-lite";

/**
 * Paid Standard-tier prices for gemini-3.5-flash-lite, USD per 1M tokens, from
 * ai.google.dev/gemini-api/docs/pricing (checked 30 Oct 2026). Image input is billed as input
 * tokens at the same rate. Update both numbers together if the price page changes.
 */
export const PRICE_PER_M = { input: 0.3, output: 2.5, checked: "2026-10-30" } as const;

/** A check fails when accuracy falls more than this below the stored baseline. */
export const CHECK_TOLERANCE = 0.02;

export const STATUSES: GradeStatus[] = ["answered", "partial", "missing", "contradicted", "not_applicable"];
export const PROOF_LABELS: ProofLabel[] = ["supports", "contradicts", "mixed", "unrelated"];

export type LabeledBy = "draft" | "rajveer" | "rajveer-spike";

export type GoldGrade = {
  source: "dataset" | "serpapi";
  asin: string;
  intentId: string;
  status: GradeStatus;
  /** Fields that state the answer (or both sides of a contradiction). Empty for missing / not_applicable. */
  fields: string[];
  labeledBy: LabeledBy;
  reason: string;
};

export type GoldProof = {
  id: string;
  asin: string;
  intentId: string;
  claim: string;
  review: { title: string; text: string };
  rating?: number;
  label: ProofLabel;
  labeledBy: LabeledBy;
  reason: string;
};

export async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

// ---------- metrics (pure) ----------

export type Confusion<L extends string> = { labels: L[]; matrix: Record<L, Record<L, number>> };

/** Rows are the gold label, columns what was predicted. */
export function confusion<L extends string>(labels: L[], pairs: { gold: L; pred: L }[]): Confusion<L> {
  const matrix = Object.fromEntries(labels.map((g) => [g, Object.fromEntries(labels.map((p) => [p, 0]))])) as Record<L, Record<L, number>>;
  for (const { gold, pred } of pairs) matrix[gold][pred]++;
  return { labels, matrix };
}

export type LabelScore = { label: string; support: number; precision: number | null; recall: number | null; f1: number | null };

/** Precision and recall per label. Null where it's undefined (nothing predicted, or nothing in gold). */
export function perLabel<L extends string>(c: Confusion<L>): LabelScore[] {
  return c.labels.map((l) => {
    const tp = c.matrix[l][l];
    const predicted = c.labels.reduce((s, g) => s + c.matrix[g][l], 0);
    const actual = c.labels.reduce((s, p) => s + c.matrix[l][p], 0);
    const precision = predicted ? tp / predicted : null;
    const recall = actual ? tp / actual : null;
    const f1 = precision === null || recall === null ? null : precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { label: l, support: actual, precision, recall, f1 };
  });
}

export function accuracy(pairs: { gold: string; pred: string }[]): number {
  return pairs.length ? pairs.filter((p) => p.gold === p.pred).length / pairs.length : 0;
}

/**
 * How the verifier moved the model's status, judged against gold:
 * toward = it changed a wrong model status into the right one; away = it changed a right one into
 * a wrong one; sideways = changed, but wrong before and after.
 */
export function verifierEffect(rows: { gold: string; model: string; verified: string }[]) {
  const changed = rows.filter((r) => r.model !== r.verified);
  return {
    changed: changed.length,
    toward: changed.filter((r) => r.verified === r.gold).length,
    away: changed.filter((r) => r.model === r.gold).length,
    sideways: changed.filter((r) => r.verified !== r.gold && r.model !== r.gold).length,
  };
}

// ---------- grades ----------

export type GradeRow = GoldGrade & { modelStatus: GradeStatus; verified: GradeStatus; cited: string[]; flags: string[] };

export class MissingRecordingError extends Error {}

function isMissingRecording(err: unknown): boolean {
  return err instanceof Error && /No recorded LLM response/.test(err.message);
}

async function intentSets(): Promise<IntentSet[]> {
  const dir = join(FIXTURES, "intents");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as IntentSet));
}

/** Replays the recorded grade for every gold listing and lines it up with the gold labels. */
export async function replayGrades(gold: GoldGrade[], llm: JsonModel): Promise<GradeRow[]> {
  const stores = fsStores({ fixturesDir: FIXTURES, imageCacheDir: "/tmp/answerable-evals-images" });
  const sets = await intentSets();
  const rows: GradeRow[] = [];
  const keys = [...new Set(gold.map((g) => `${g.source}:${g.asin}`))];
  for (const key of keys) {
    const [source, asin] = key.split(":") as [GoldGrade["source"], string];
    const raw = await stores.listings.get(source, asin);
    if (!raw) throw new Error(`Gold set names ${source} ${asin}, but there's no fixture for it.`);
    const listing = normalize(raw);
    const set = resolveIntentSet(listing, sets);
    if (!set) throw new Error(`No question set matches ${source} ${asin}.`);
    const run = await gradeListing(listing, set, llm, MODEL).catch((err) => {
      if (isMissingRecording(err)) {
        throw new MissingRecordingError(
          `No recorded grade for ${source} ${asin} (${GRADE_PROMPT_VERSION}). Record it once with:\n  bun --env-file=.env apps/cli/src/audit.ts ${asin} --source ${source} --record`,
        );
      }
      throw err;
    });
    for (const g of gold.filter((x) => x.source === source && x.asin === asin)) {
      const grade = run.grades.find((x) => x.intentId === g.intentId);
      if (!grade) throw new Error(`${source} ${asin}: gold intent ${g.intentId} isn't a gradable question in ${set.categoryId}.`);
      rows.push({ ...g, modelStatus: grade.modelStatus, verified: grade.status, cited: [...new Set(grade.quotes.map((q) => q.fieldId))], flags: grade.flags });
    }
  }
  return rows;
}

/**
 * Evidence: when both gold and the grade name fields, are the cited fields ones that really carry
 * the answer? precision = share of cited fields that are in gold; hit = at least one is.
 */
export function evidenceScore(rows: GradeRow[]) {
  const scored = rows.filter((r) => r.fields.length > 0 && r.cited.length > 0);
  const cited = scored.reduce((s, r) => s + r.cited.length, 0);
  const good = scored.reduce((s, r) => s + r.cited.filter((f) => r.fields.includes(f)).length, 0);
  return { pairs: scored.length, precision: cited ? good / cited : 0, hitRate: scored.length ? scored.filter((r) => r.cited.some((f) => r.fields.includes(f))).length / scored.length : 0 };
}

// ---------- proof ----------

export type ProofRow = GoldProof & { pred: ProofLabel | null };

/** Labels the gold reviews with the same function the audit uses, one batch per claim. */
export async function replayProof(gold: GoldProof[], llm: JsonModel): Promise<ProofRow[]> {
  const sets = await intentSets();
  const questions = new Map(sets.flatMap((s) => s.intents.map((i) => [i.id, i.question] as const)));
  const groups = new Map<string, GoldProof[]>();
  for (const g of gold) {
    const key = `${g.asin}|${g.intentId}|${g.claim}`;
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const rows: ProofRow[] = [];
  for (const items of groups.values()) {
    const first = items[0]!;
    const run = await labelReviews(
      { intentId: first.intentId, sources: [{ kind: "field", id: "gold", text: first.claim }] },
      { question: questions.get(first.intentId) ?? first.intentId },
      items.map((i) => i.review),
      llm,
      MODEL,
    ).catch((err) => {
      if (isMissingRecording(err)) {
        throw new MissingRecordingError(`No recorded proof labels for ${first.asin} ${first.intentId} (${PROOF_PROMPT_VERSION}). Record once with:\n  bun --env-file=.env evals/run.ts --record`);
      }
      throw err;
    });
    items.forEach((g, k) => rows.push({ ...g, pred: run.labels[k] ?? null }));
  }
  return rows;
}

// ---------- cost ----------

export type AuditCost = { source: string; asin: string; requests: number; inputTokens: number; outputTokens: number; byStep: Record<string, { requests: number; inputTokens: number; outputTokens: number }>; vision: { inputTokens: number; outputTokens: number } };

/** Wraps a client so each request's usage is filed under its step (the prompt version's name). */
function byStep(llm: JsonModel, steps: AuditCost["byStep"]): JsonModel {
  return {
    async generateJson<T>(req: JsonRequest) {
      const res = await llm.generateJson<T>(req);
      const step = req.promptVersion.split("@")[0]!;
      const s = (steps[step] ??= { requests: 0, inputTokens: 0, outputTokens: 0 });
      s.requests++;
      s.inputTokens += res.usage.inputTokens;
      s.outputTokens += res.usage.outputTokens;
      return res;
    },
  };
}

/**
 * What every fixture's full audit costs, from recorded usage. Competitor grading is included, as a
 * first audit would pay it; image transcription is saved separately, so its usage is read from
 * the saved transcription.
 */
export async function auditCosts(llm: JsonModel): Promise<AuditCost[]> {
  const stores = fsStores({ fixturesDir: FIXTURES, imageCacheDir: "/tmp/answerable-evals-images" });
  const out: AuditCost[] = [];
  for (const source of ["serpapi", "dataset"] as const) {
    for (const asin of await stores.listings.saved(source)) {
      const steps: AuditCost["byStep"] = {};
      const r = await runAudit({ asin, source }, { llm: byStep(llm, steps), vision: null, model: MODEL, ...stores, images: null });
      const saved = (await stores.imageClaims.get(source, asin)) as { usage?: { inputTokens: number; outputTokens: number } } | null;
      out.push({ source, asin, requests: r.usage.requests, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, byStep: steps, vision: saved?.usage ?? { inputTokens: 0, outputTokens: 0 } });
    }
  }
  return out;
}

export function dollars(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICE_PER_M.input + outputTokens * PRICE_PER_M.output) / 1_000_000;
}

// ---------- everything ----------

export type EvalResult = {
  grades: { rows: GradeRow[]; accuracy: number; modelAccuracy: number; perStatus: LabelScore[]; confusion: Confusion<GradeStatus>; verifier: ReturnType<typeof verifierEffect>; evidence: ReturnType<typeof evidenceScore> };
  proof: { rows: ProofRow[]; accuracy: number; clearAccuracy: number; perLabel: LabelScore[]; confusion: Confusion<ProofLabel | "none">; unlabelled: number };
  costs: AuditCost[];
  drafts: { grades: number; proof: number };
};

export type Baseline = { gradeAccuracy: number; proofAccuracy: number; gradePairs: number; proofPairs: number; gradePromptVersion: string; proofPromptVersion: string };

export async function runEvals(llm: JsonModel): Promise<EvalResult> {
  const goldGrades = await readJsonl<GoldGrade>(join(import.meta.dir, "gold/grades.jsonl"));
  const goldProof = await readJsonl<GoldProof>(join(import.meta.dir, "gold/proof.jsonl"));

  const rows = await replayGrades(goldGrades, llm);
  const verifiedPairs = rows.map((r) => ({ gold: r.status, pred: r.verified }));
  const gc = confusion(STATUSES, verifiedPairs);

  const prows = await replayProof(goldProof, llm);
  const pairs = prows.map((r) => ({ gold: r.label as ProofLabel | "none", pred: (r.pred ?? "none") as ProofLabel | "none" }));
  const pc = confusion<ProofLabel | "none">([...PROOF_LABELS, "none"], pairs);
  // The spike's "clear cases": gold supports or contradicts. Mixed is the hard, new label.
  const clear = pairs.filter((p) => p.gold === "supports" || p.gold === "contradicts");

  return {
    grades: {
      rows,
      accuracy: accuracy(verifiedPairs),
      modelAccuracy: accuracy(rows.map((r) => ({ gold: r.status, pred: r.modelStatus }))),
      perStatus: perLabel(gc),
      confusion: gc,
      verifier: verifierEffect(rows.map((r) => ({ gold: r.status, model: r.modelStatus, verified: r.verified }))),
      evidence: evidenceScore(rows),
    },
    proof: {
      rows: prows,
      accuracy: accuracy(pairs),
      clearAccuracy: accuracy(clear),
      perLabel: perLabel(pc).filter((s) => s.label !== "none"),
      confusion: pc,
      unlabelled: prows.filter((r) => r.pred === null).length,
    },
    costs: await auditCosts(llm),
    drafts: { grades: goldGrades.filter((g) => g.labeledBy === "draft").length, proof: goldProof.filter((g) => g.labeledBy === "draft").length },
  };
}

export function baselineOf(r: EvalResult): Baseline {
  return {
    gradeAccuracy: round(r.grades.accuracy),
    proofAccuracy: round(r.proof.accuracy),
    gradePairs: r.grades.rows.length,
    proofPairs: r.proof.rows.length,
    gradePromptVersion: GRADE_PROMPT_VERSION,
    proofPromptVersion: PROOF_PROMPT_VERSION,
  };
}

/**
 * Problems that should fail CI: accuracy more than CHECK_TOLERANCE below the stored baseline, or a
 * baseline that was measured on something else. A changed gold set or prompt makes the old number
 * meaningless to compare against, so the check stops and asks for a deliberate re-baseline.
 */
export function checkAgainst(r: EvalResult, base: Baseline): string[] {
  const now = baselineOf(r);
  const problems: string[] = [];
  const fix = "review the change, then run `bun evals --update-baseline`";
  if (now.gradePairs !== base.gradePairs) problems.push(`the baseline was measured on ${base.gradePairs} grade pairs, this run has ${now.gradePairs}: ${fix}`);
  if (now.proofPairs !== base.proofPairs) problems.push(`the baseline was measured on ${base.proofPairs} proof pairs, this run has ${now.proofPairs}: ${fix}`);
  if (now.gradePromptVersion !== base.gradePromptVersion) problems.push(`the baseline is for ${base.gradePromptVersion}, this run uses ${now.gradePromptVersion}: ${fix}`);
  if (now.proofPromptVersion !== base.proofPromptVersion) problems.push(`the baseline is for ${base.proofPromptVersion}, this run uses ${now.proofPromptVersion}: ${fix}`);
  if (r.grades.accuracy < base.gradeAccuracy - CHECK_TOLERANCE) problems.push(`grade accuracy ${pct(r.grades.accuracy)} is below baseline ${pct(base.gradeAccuracy)} minus ${pct(CHECK_TOLERANCE)}`);
  if (r.proof.accuracy < base.proofAccuracy - CHECK_TOLERANCE) problems.push(`proof label accuracy ${pct(r.proof.accuracy)} is below baseline ${pct(base.proofAccuracy)} minus ${pct(CHECK_TOLERANCE)}`);
  return problems;
}

export const round = (x: number) => Math.round(x * 10000) / 10000;
export const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
