export type ListingSource = "dataset" | "serpapi" | "paste";

/** A listing exactly as a source returned it. Core's normalize turns `data` into fields. */
export type RawListing = {
  source: ListingSource;
  requestedAsin: string;
  fetchedAt: string;
  data: unknown;
};

export interface ProductDataProvider {
  readonly name: string;
  getListing(asin: string): Promise<RawListing | null>;
}

export type LlmPart =
  | { text: string }
  | { image: { mimeType: string; base64: string } };

export type LlmRequest = {
  model: string;
  parts: LlmPart[];
  /** JSON schema in Gemini's responseSchema dialect. */
  schema: unknown;
  temperature?: number;
  /** Recorded with every result so grades can be traced to a prompt. */
  promptVersion: string;
};

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmResult<T = unknown> = {
  data: T;
  model: string;
  promptVersion: string;
  usage: LlmUsage;
  latencyMs: number;
  cached: boolean;
};

export interface LlmProvider {
  readonly name: string;
  generateJson<T = unknown>(req: LlmRequest): Promise<LlmResult<T>>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
