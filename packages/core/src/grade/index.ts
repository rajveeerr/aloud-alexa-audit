import type { Grade, IntentSet, Listing } from "../types";
import { buildGradePrompt, GRADE_PROMPT_VERSION, GRADE_SCHEMA, gradableIntents } from "./prompt";
import { verifyGrades } from "./verify";

export { buildGradePrompt, GRADE_PROMPT_VERSION, GRADE_SCHEMA, gradableIntents } from "./prompt";
export { verifyGrades } from "./verify";
export { quoteMatches } from "./match";

/**
 * Any model that returns JSON for a prompt and a schema. Core only sees this interface, so
 * tests pass a fake and the app passes the cached Gemini client from providers.
 */
export interface JsonModel {
  generateJson<T = unknown>(req: {
    model: string;
    promptVersion: string;
    parts: { text: string }[];
    schema: unknown;
    temperature?: number;
  }): Promise<{
    data: T;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
    latencyMs: number;
    cached: boolean;
  }>;
}

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
