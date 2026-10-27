/** A text or image part of a prompt. Same shape as providers' LlmPart, so the Gemini client fits. */
export type PromptPart = { text: string } | { image: { mimeType: string; base64: string } };

export type JsonRequest = {
  model: string;
  /** Recorded with every result and part of the cache key. */
  promptVersion: string;
  parts: PromptPart[];
  schema: unknown;
  temperature?: number;
};

export type JsonResponse<T> = {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  cached: boolean;
};

/**
 * Any model that returns JSON for a prompt and a schema. Core only sees this interface, so
 * tests pass a fake and the app passes the cached Gemini client from providers.
 */
export interface JsonModel {
  generateJson<T = unknown>(req: JsonRequest): Promise<JsonResponse<T>>;
}
