/**
 * Everything the review page shows besides the labels: each listing's normalized fields, each
 * question's rubric, and what the tool said, replayed from fixtures/llm exactly as `bun evals` does.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalize, resolveIntentSet, type Field, type GradeStatus, type Intent, type IntentSet, type ProofLabel } from "@aloud/core";
import { fsStores } from "@aloud/pipeline";
import { CachedLlm } from "@aloud/providers";
import { FIXTURES, readJsonl, replayGrades, replayProof, type GoldGrade, type GoldProof } from "../lib";
import { gradeKey } from "./jsonl";

export const GOLD = join(import.meta.dir, "..", "gold");
export const GRADES_PATH = join(GOLD, "grades.jsonl");
export const PROOF_PATH = join(GOLD, "proof.jsonl");

export type ListingView = { source: string; asin: string; title: string; brand?: string; category: string; fields: Field[] };
export type QuestionView = Pick<Intent, "id" | "kind" | "question" | "rubric"> & { conditional: boolean };
export type GradeTool = { verified: GradeStatus; modelStatus: GradeStatus; cited: string[]; flags: string[] };

/** Context that doesn't change while reviewing: listings, questions and the tool's answers. */
export type ReviewContext = {
  listings: Record<string, ListingView>;
  /** By gradeKey. */
  questions: Record<string, QuestionView>;
  gradeTool: Record<string, GradeTool>;
  /** Proof questions by intent id, and the tool's label by proof row id. */
  proofQuestions: Record<string, string>;
  proofTool: Record<string, ProofLabel | null>;
};

async function intentSets(): Promise<IntentSet[]> {
  const dir = join(FIXTURES, "intents");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as IntentSet));
}

const view = (i: Intent): QuestionView => ({ id: i.id, kind: i.kind, question: i.question, rubric: i.rubric, conditional: i.conditional === true });

export async function loadContext(): Promise<ReviewContext> {
  const grades = await readJsonl<GoldGrade>(GRADES_PATH);
  const proof = await readJsonl<GoldProof>(PROOF_PATH);
  const stores = fsStores({ fixturesDir: FIXTURES, imageCacheDir: "/tmp/aloud-evals-images" });
  const sets = await intentSets();

  const listings: ReviewContext["listings"] = {};
  const questions: ReviewContext["questions"] = {};
  for (const g of grades) {
    const key = `${g.source}:${g.asin}`;
    if (!listings[key]) {
      const raw = await stores.listings.get(g.source, g.asin);
      if (!raw) throw new Error(`Gold set names ${key}, but there's no fixture for it.`);
      const listing = normalize(raw);
      const set = resolveIntentSet(listing, sets);
      listings[key] = {
        source: g.source,
        asin: g.asin,
        title: listing.fields.find((f) => f.kind === "title")?.text ?? g.asin,
        ...(listing.meta.brand ? { brand: listing.meta.brand } : {}),
        category: set?.categoryName ?? "no matching question set",
        fields: listing.fields,
      };
      for (const i of set?.intents ?? []) questions[`${key}:${i.id}`] = view(i);
    }
  }

  // Same replay as evals/lib.ts, so "tool said" is exactly what the eval scores.
  const llm = new CachedLlm(null, join(FIXTURES, "llm"), "replay");
  const gradeTool: ReviewContext["gradeTool"] = {};
  for (const r of await replayGrades(grades, llm)) gradeTool[gradeKey(r)] = { verified: r.verified, modelStatus: r.modelStatus, cited: r.cited, flags: r.flags };
  const proofTool: ReviewContext["proofTool"] = {};
  for (const r of await replayProof(proof, llm)) proofTool[r.id] = r.pred;

  const proofQuestions = Object.fromEntries(sets.flatMap((s) => s.intents.map((i) => [i.id, i.question] as const)));
  return { listings, questions, gradeTool, proofQuestions, proofTool };
}
