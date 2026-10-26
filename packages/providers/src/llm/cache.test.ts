import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CachedLlm, requestKey } from "./cache";
import type { LlmProvider, LlmRequest, LlmResult } from "../types";

const req: LlmRequest = { model: "m", parts: [{ text: "hi" }], schema: {}, promptVersion: "p@1" };

class CountingLlm implements LlmProvider {
  readonly name = "counting";
  calls = 0;
  async generateJson<T>(r: LlmRequest): Promise<LlmResult<T>> {
    this.calls++;
    return { data: { n: this.calls } as T, model: r.model, promptVersion: r.promptVersion, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 5, cached: false };
  }
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "llm-cache-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("requestKey", () => {
  test("changes when the prompt version changes", () => {
    expect(requestKey(req)).not.toBe(requestKey({ ...req, promptVersion: "p@2" }));
  });

  test("hashes image data instead of embedding it", () => {
    const a = requestKey({ ...req, parts: [{ image: { mimeType: "image/jpeg", base64: "AAAA" } }] });
    const b = requestKey({ ...req, parts: [{ image: { mimeType: "image/jpeg", base64: "BBBB" } }] });
    expect(a).not.toBe(b);
  });
});

describe("CachedLlm", () => {
  test("record mode calls through once, then serves from disk", async () => {
    const inner = new CountingLlm();
    const llm = new CachedLlm(inner, dir, "record");
    const first = await llm.generateJson<{ n: number }>(req);
    const second = await llm.generateJson<{ n: number }>(req);
    expect(inner.calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.data.n).toBe(1);
  });

  test("replay mode never calls through and fails on a miss", async () => {
    const inner = new CountingLlm();
    const llm = new CachedLlm(inner, dir, "replay");
    await expect(llm.generateJson(req)).rejects.toThrow("No recorded LLM response");
    expect(inner.calls).toBe(0);
  });

  test("replay mode serves what record mode saved", async () => {
    await new CachedLlm(new CountingLlm(), dir, "record").generateJson(req);
    const replayed = await new CachedLlm(null, dir, "replay").generateJson<{ n: number }>(req);
    expect(replayed.data.n).toBe(1);
  });
});
