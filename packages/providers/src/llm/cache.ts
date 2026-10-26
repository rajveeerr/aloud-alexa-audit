import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProviderError, type LlmProvider, type LlmRequest, type LlmResult } from "../types";

/**
 * - `replay`: answer only from disk; a miss is an error. Tests use this so they never call an API.
 * - `record`: answer from disk when possible, otherwise call through and save the result.
 */
export type CacheMode = "replay" | "record";

/** Stable key for a request. Images are hashed so keys stay short. */
export function requestKey(req: LlmRequest): string {
  const parts = req.parts.map((p) =>
    "text" in p ? { text: p.text } : { image: createHash("sha256").update(p.image.base64).digest("hex") },
  );
  const canonical = JSON.stringify({
    model: req.model,
    promptVersion: req.promptVersion,
    temperature: req.temperature ?? 0,
    schema: req.schema,
    parts,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class CachedLlm implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly inner: LlmProvider | null,
    private readonly dir: string,
    private readonly mode: CacheMode,
  ) {
    this.name = `cached:${inner?.name ?? "none"}`;
  }

  async generateJson<T = unknown>(req: LlmRequest): Promise<LlmResult<T>> {
    const key = requestKey(req);
    const path = join(this.dir, `${key}.json`);

    const hit = await readFile(path, "utf8").then(
      (text) => JSON.parse(text) as LlmResult<T>,
      () => null,
    );
    if (hit) return { ...hit, cached: true };

    if (this.mode === "replay" || !this.inner) {
      throw new ProviderError(`No recorded LLM response for ${key} (${req.promptVersion})`, this.name);
    }

    const result = await this.inner.generateJson<T>(req);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, JSON.stringify(result, null, 2));
    return result;
  }
}
