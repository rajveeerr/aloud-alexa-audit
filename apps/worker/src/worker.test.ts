import { describe, expect, test } from "bun:test";
import { AuditError } from "@aloud/pipeline";
import { CachedLlm, ProviderError, QuotaExhaustedError, type LlmProvider, type LlmRequest } from "@aloud/providers";
import { classify, INTERNAL_MESSAGE } from "./errors";
import { isRedisDown } from "./queue";
import { rateLimited } from "./limiter";
import { toAuditRequest } from "./processor";
import { sendWebhook, sign, SIGNATURE_HEADER, verify } from "./webhook";

describe("classify", () => {
  test("a used-up daily quota waits, it doesn't fail", () => {
    expect(classify(new QuotaExhaustedError("out", "GenerateRequestsPerDay")).kind).toBe("quota");
  });

  test("audit errors fail at once with their own code", () => {
    expect(classify(new AuditError("nope", "listing_not_found"))).toMatchObject({ kind: "fail", code: "listing_not_found" });
    expect(classify(new AuditError("nope", "bad_request"))).toMatchObject({ kind: "fail", code: "bad_request" });
  });

  test("retryable provider errors retry; others fail", () => {
    expect(classify(new ProviderError("503", "gemini", 503, true))).toMatchObject({ kind: "retry", code: "provider_unavailable" });
    expect(classify(new ProviderError("refused", "gemini", undefined, false, "SAFETY"))).toMatchObject({ kind: "fail", code: "provider_error" });
  });

  test("a missing replay recording is not_recorded, not a provider error", async () => {
    const llm = new CachedLlm(null, "/tmp/aloud-empty-llm-cache", "replay");
    const err = await llm.generateJson({ model: "m", parts: [{ text: "never recorded" }], schema: {}, promptVersion: "v" }).catch((e) => e);
    expect(classify(err)).toMatchObject({ kind: "fail", code: "not_recorded" });
    expect(classify(err).message).not.toContain("No recorded");
  });

  test("anything else retries and ends as internal, with a message that hides the details", () => {
    expect(classify(new TypeError("cannot read 'password' of undefined"))).toEqual({ kind: "retry", code: "internal", message: INTERNAL_MESSAGE });
    expect(classify("thrown string")).toMatchObject({ kind: "retry", code: "internal", message: INTERNAL_MESSAGE });
  });
});

describe("isRedisDown", () => {
  test("redis outages are told apart from command errors", () => {
    expect(isRedisDown(Object.assign(new Error("Reached the max retries per request limit (which is 1)."), { name: "MaxRetriesPerRequestError" }))).toBe(true);
    expect(isRedisDown(new Error("Command timed out"))).toBe(true);
    expect(isRedisDown(new Error("connect ECONNREFUSED 127.0.0.1:6399"))).toBe(true);
    expect(isRedisDown(new Error("WRONGTYPE Operation against a key holding the wrong kind of value"))).toBe(false);
  });
});

describe("webhook signing", () => {
  const body = JSON.stringify({ type: "audit.completed", auditId: "a1", asin: "B0C9W8DD9S", score: 52 });

  test("is HMAC-SHA256 of the body, hex, with a scheme prefix", () => {
    const expected = new Bun.CryptoHasher("sha256", "s3cret").update(body).digest("hex");
    expect(sign(body, "s3cret")).toBe(`sha256=${expected}`);
  });

  test("verify accepts the right secret and rejects an edited body", () => {
    const sig = sign(body, "s3cret");
    expect(verify(body, "s3cret", sig)).toBe(true);
    expect(verify(body.replace("52", "99"), "s3cret", sig)).toBe(false);
    expect(verify(body, "other", sig)).toBe(false);
    expect(verify(body, "s3cret", "sha256=short")).toBe(false);
  });

  test("sendWebhook posts the signed body", async () => {
    let seen: { url: string; headers: Headers; body: string } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: String(init.body) };
      return new Response("ok");
    }) as unknown as typeof fetch;
    await sendWebhook({ url: "https://example.test/hook", secret: "k", fetch: fakeFetch }, { type: "audit.completed", auditId: "a1", asin: "B0C9W8DD9S", score: 52 });
    expect(seen!.url).toBe("https://example.test/hook");
    expect(verify(seen!.body, "k", seen!.headers.get(SIGNATURE_HEADER)!)).toBe(true);
  });

  test("a non-2xx answer is an error for the caller to log", async () => {
    const fakeFetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(sendWebhook({ url: "https://example.test/hook", secret: "k", fetch: fakeFetch }, { type: "audit.completed", auditId: "a", asin: "B0C9W8DD9S", score: null })).rejects.toThrow("500");
  });
});

describe("rateLimited", () => {
  test("spaces calls evenly at the given requests per minute", async () => {
    let now = 0;
    const waits: number[] = [];
    const inner: LlmProvider = {
      name: "fake",
      generateJson: async <T>() => ({ data: {} as T, model: "m", promptVersion: "v", usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0, cached: false }),
    };
    const limited = rateLimited(inner, 60, { now: () => now, sleep: async (ms) => void waits.push(ms) });
    const req = { model: "m", parts: [], schema: {}, promptVersion: "v" } satisfies LlmRequest;
    await Promise.all([limited.generateJson(req), limited.generateJson(req), limited.generateJson(req)]);
    expect(waits).toEqual([1000, 2000]);
    now = 10_000;
    await limited.generateJson(req);
    expect(waits).toEqual([1000, 2000]);
  });
});

describe("toAuditRequest", () => {
  test("restores what was stored and drops empty optionals", () => {
    expect(toAuditRequest({ requestedAsin: "B0C9W8DD9S", source: "serpapi", request: { live: false, competitors: [] } })).toEqual({
      asin: "B0C9W8DD9S",
      source: "serpapi",
      live: false,
    });
    expect(toAuditRequest({ requestedAsin: "B0PASTE001", source: "paste", request: { paste: { title: "A pen" }, category: "Pens" } })).toEqual({
      asin: "B0PASTE001",
      source: "paste",
      live: false,
      paste: { title: "A pen" },
      category: "Pens",
    });
  });
});
