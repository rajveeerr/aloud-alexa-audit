import type { JsonModel } from "../llm";
import type { Grade, IntentSet, Listing } from "../types";
import { buildGradePrompt, GRADE_PROMPT_VERSION, GRADE_SCHEMA, gradableIntents } from "./prompt";
import { verifyGrades } from "./verify";

export { buildGradePrompt, GRADE_PROMPT_VERSION, GRADE_SCHEMA, gradableIntents } from "./prompt";
export { verifyGrades } from "./verify";
export { quoteMatches } from "./match";
export type { JsonModel } from "../llm";

export type GradeRun = {
  grades: Grade[];
  /** The model's answer before verification, kept for evals. */
  modelOutput: unknown;
  model: string;
  promptVersion: string;
  intentSetVersion: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  cached: boolean;
};

/** One request grades every question for one listing, then the verifier checks it. */
export async function gradeListing(listing: Listing, intentSet: IntentSet, llm: JsonModel, model: string): Promise<GradeRun> {
  const intents = gradableIntents(intentSet.intents);
  const res = await llm.generateJson({
    model,
    promptVersion: `${GRADE_PROMPT_VERSION}+${intentSet.categoryId}@${intentSet.version}`,
    parts: [{ text: buildGradePrompt(listing, intents) }],
    schema: GRADE_SCHEMA,
    temperature: 0,
  });
  return {
    grades: verifyGrades(listing, intents, res.data),
    modelOutput: res.data,
    model: res.model,
    promptVersion: GRADE_PROMPT_VERSION,
    intentSetVersion: intentSet.version,
    usage: res.usage,
    latencyMs: res.latencyMs,
    cached: res.cached,
  };
}
