import { join } from "node:path";
import { fsStores, type AuditDeps, type AuditRequest } from "@answerable/pipeline";
import { CachedLlm, GeminiLlm } from "@answerable/providers";
import { rateLimited } from "./limiter";

export const ROOT = join(import.meta.dir, "../../..");

export type DepsConfig = {
  fixturesDir: string;
  llmCacheDir: string;
  imageCacheDir: string;
  model: string;
  geminiApiKey?: string;
  geminiRpm: number;
  serpApiKey?: string;
};

export function depsConfigFromEnv(env: Record<string, string | undefined> = process.env): DepsConfig {
  return {
    fixturesDir: env.FIXTURES_DIR ?? join(ROOT, "fixtures"),
    llmCacheDir: env.LLM_CACHE_DIR ?? join(ROOT, "fixtures/llm"),
    imageCacheDir: env.IMAGE_CACHE_DIR ?? join(ROOT, "data/images"),
    model: env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    geminiRpm: Number(env.GEMINI_RPM ?? 10),
    ...(env.GEMINI_API_KEY && { geminiApiKey: env.GEMINI_API_KEY }),
    ...(env.SERPAPI_KEY && { serpApiKey: env.SERPAPI_KEY }),
  };
}

/**
 * Builds runAudit's dependencies the way the CLI does. With a Gemini key, anything not recorded
 * yet is called and saved; without one, the audit replays recordings only, so a demo costs nothing.
 * Live SerpApi fetches happen only when the audit asked for them and a key is configured.
 */
export function makeDeps(cfg: DepsConfig): (req: AuditRequest) => AuditDeps {
  const gemini = cfg.geminiApiKey ? rateLimited(new GeminiLlm({ apiKey: cfg.geminiApiKey }), cfg.geminiRpm) : null;
  const llm = new CachedLlm(gemini, cfg.llmCacheDir, gemini ? "record" : "replay");

  return (req) => {
    const live = !!req.live && !!cfg.serpApiKey;
    const stores = fsStores({
      fixturesDir: cfg.fixturesDir,
      imageCacheDir: cfg.imageCacheDir,
      ...(live && cfg.serpApiKey && { serpApiKey: cfg.serpApiKey }),
    });
    // Image transcriptions are saved separately, so the vision model is the uncached client.
    return { llm, vision: gemini, model: cfg.model, ...stores, images: gemini ? stores.images : null };
  };
}
