import { describe, expect, test } from "bun:test";
import { GeminiLlm, QuotaExhaustedError } from "./gemini";
import type { LlmRequest } from "../types";

const req: LlmRequest = {
  model: "gemini-3.5-flash-lite",
  parts: [{ text: "grade this" }],
  schema: { type: "OBJECT" },
  promptVersion: "grade@1",
};

const noSleep = { sleep: async () => {} };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const ok = () => respond(200, {
  candidates: [{ content: { parts: [{ text: '{"status":"answered"}' }] } }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8 },
  modelVersion: "gemini-3.5-flash-lite-001",
});

describe("GeminiLlm", () => {
  test("parses JSON output and records usage, model and prompt version", async () => {
    const { fn, calls } = fakeFetch(ok());
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: noSleep });
    const res = await llm.generateJson<{ status: string }>(req);

    expect(res.data.status).toBe("answered");
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 8 });
    expect(res.model).toBe("gemini-3.5-flash-lite-001");
    expect(res.promptVersion).toBe("grade@1");
    expect(calls[0]!.url).toEndWith("/gemini-3.5-flash-lite:generateContent");
    const sent = JSON.parse(String(calls[0]!.init!.body));
    expect(sent.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.generationConfig.temperature).toBe(0);
  });

  test("sends images as inline data", async () => {
    const { fn, calls } = fakeFetch(ok());
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: noSleep });
    await llm.generateJson({ ...req, parts: [{ image: { mimeType: "image/jpeg", base64: "AAAA" } }] });
    const sent = JSON.parse(String(calls[0]!.init!.body));
    expect(sent.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "AAAA" } });
  });

  test("retries a per-minute 429 and then succeeds", async () => {
    const perMinute = respond(429, {
      error: { message: "slow down", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] },
    });
    const { fn, calls } = fakeFetch(perMinute, ok());
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: noSleep });
    await llm.generateJson(req);
    expect(calls).toHaveLength(2);
  });

  test("does not retry a daily quota and throws QuotaExhaustedError", async () => {
    const perDay = respond(429, {
      error: { message: "quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] },
    });
    const { fn, calls } = fakeFetch(perDay);
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: noSleep });
    const err = await llm.generateJson(req).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExhaustedError);
    expect(err.quotaId).toContain("PerDay");
    expect(calls).toHaveLength(1);
  });

  test("does not retry a 400", async () => {
    const { fn, calls } = fakeFetch(respond(400, { error: { message: "bad schema" } }));
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: noSleep });
    await expect(llm.generateJson(req)).rejects.toThrow("bad schema");
    expect(calls).toHaveLength(1);
  });

  test("gives up after the retry budget on repeated 503s", async () => {
    const down = () => respond(503, { error: { message: "overloaded" } });
    const { fn, calls } = fakeFetch(down(), down(), down());
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: { ...noSleep, attempts: 3 } });
    await expect(llm.generateJson(req)).rejects.toThrow("overloaded");
    expect(calls).toHaveLength(3);
  });

  test("aborts a request that never answers, and retries it", async () => {
    let calls = 0;
    const hang = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
      }
      return ok();
    }) as typeof fetch;
    const llm = new GeminiLlm({ apiKey: "k", fetch: hang, retry: noSleep, timeoutMs: 20 });
    const res = await llm.generateJson(req);
    expect(calls).toBe(2);
    expect(res.data).toEqual({ status: "answered" });
  });

  test("rejects output that isn't JSON", async () => {
    const bad = respond(200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] });
    const { fn } = fakeFetch(bad);
    const llm = new GeminiLlm({ apiKey: "k", fetch: fn, retry: noSleep });
    await expect(llm.generateJson(req)).rejects.toThrow("invalid JSON");
  });
});
