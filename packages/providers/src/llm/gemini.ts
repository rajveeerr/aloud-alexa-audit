import { isRetryableStatus, withRetry, type RetryOptions } from "../retry";
import { ProviderError, type LlmProvider, type LlmRequest, type LlmResult } from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Thrown when a daily quota is used up. The queue should pause until reset, not retry. */
export class QuotaExhaustedError extends ProviderError {
  constructor(
    message: string,
    readonly quotaId: string,
  ) {
    super(message, "gemini", 429, false);
    this.name = "QuotaExhaustedError";
  }
}

export type GeminiOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
};

type GeminiErrorBody = {
  error?: {
    message?: string;
    details?: { "@type"?: string; violations?: { quotaId?: string }[] }[];
  };
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
};

export class GeminiLlm implements LlmProvider {
  readonly name = "gemini";
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: GeminiOptions) {
    if (!opts.apiKey) throw new Error("Gemini API key is missing");
    this.fetch = opts.fetch ?? fetch;
  }

  async generateJson<T = unknown>(req: LlmRequest): Promise<LlmResult<T>> {
    const body = {
      contents: [
        {
          parts: req.parts.map((p) =>
            "text" in p ? { text: p.text } : { inline_data: { mime_type: p.image.mimeType, data: p.image.base64 } },
          ),
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: req.schema,
        temperature: req.temperature ?? 0,
      },
    };

    const started = performance.now();
    const json = await withRetry(() => this.post(req.model, body), this.opts.retry);
    const latencyMs = Math.round(performance.now() - started);

    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      const reason = candidate?.finishReason ?? "none";
      throw new ProviderError(`Gemini returned no content (finishReason ${reason})`, this.name, undefined, false, reason);
    }
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new ProviderError("Gemini returned invalid JSON", this.name);
    }

    return {
      data,
      model: json.modelVersion ?? req.model,
      promptVersion: req.promptVersion,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
      latencyMs,
      cached: false,
    };
  }

  private async post(model: string, body: unknown): Promise<GeminiResponse> {
    let res: Response;
    try {
      res = await this.fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(`Gemini request failed: ${(err as Error).message}`, this.name, undefined, true);
    }
    if (res.ok) return (await res.json()) as GeminiResponse;

    const errBody = (await res.json().catch(() => ({}))) as GeminiErrorBody;
    const message = errBody.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) {
      const quotaId = errBody.error?.details
        ?.flatMap((d) => d.violations ?? [])
        .map((v) => v.quotaId ?? "")
        .find((id) => /PerDay/i.test(id));
      if (quotaId) throw new QuotaExhaustedError(`Gemini daily quota exhausted: ${quotaId}`, quotaId);
    }
    throw new ProviderError(`Gemini: ${message}`, this.name, res.status, isRetryableStatus(res.status));
  }
}
