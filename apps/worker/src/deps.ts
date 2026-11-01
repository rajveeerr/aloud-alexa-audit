import { join } from "node:path";
import type { IntentSet } from "@aloud/core";
import { allQuestionSets, saveQuestionSet, type Db } from "@aloud/db";
import { fsStores, type AuditDeps, type AuditRequest, type IntentSetStore } from "@aloud/pipeline";
import { CachedLlm, GeminiLlm, PATIENT_RETRY } from "@aloud/providers";
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
    fixturesDir: env.FIXTURES_DIR || join(ROOT, "fixtures"),
    llmCacheDir: env.LLM_CACHE_DIR || join(ROOT, "fixtures/llm"),
    imageCacheDir: env.IMAGE_CACHE_DIR || join(ROOT, "data/images"),
    model: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    geminiRpm: Number(env.GEMINI_RPM || 10),
    ...(env.GEMINI_API_KEY && { geminiApiKey: env.GEMINI_API_KEY }),
    ...(env.SERPAPI_KEY && { serpApiKey: env.SERPAPI_KEY }),
  };
}

/**
 * Builds runAudit's dependencies the way the CLI does. With a Gemini key, anything not recorded
 * yet is called and saved; without one, the audit replays recordings only, so a demo costs nothing.
 * Live SerpApi fetches happen only when the audit asked for them and a key is configured.
 */
/** Better kinds of question set win when the same category has more than one. */
const BASIS_RANK = { mined: 3, insights: 2, estimated: 1 } as const;

/**
 * Committed sets from fixtures plus sets the worker saved in the database. For one category the
 * better basis wins (mined over review topics over estimated); a tie keeps the committed one, which
 * may have been reviewed by hand. New sets go to the database, which survives a restart.
 */
export function dbIntentSets(db: Db, files: IntentSetStore): IntentSetStore {
  return {
    async all() {
      const best = new Map<string, IntentSet>();
      for (const s of [...(await files.all()), ...((await allQuestionSets(db)) as IntentSet[])]) {
        const had = best.get(s.categoryId);
        if (!had || BASIS_RANK[s.basis] > BASIS_RANK[had.basis]) best.set(s.categoryId, s);
      }
      return [...best.values()].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1));
    },
    async save(set, note) {
      await saveQuestionSet(db, { categoryId: set.categoryId, basis: set.basis, set, note });
    },
  };
}

export function makeDeps(cfg: DepsConfig, db?: Db): (req: AuditRequest) => AuditDeps {
  const gemini = cfg.geminiApiKey ? rateLimited(new GeminiLlm({ apiKey: cfg.geminiApiKey, retry: PATIENT_RETRY }), cfg.geminiRpm) : null;
  const llm = new CachedLlm(gemini, cfg.llmCacheDir, gemini ? "record" : "replay");

  return (req) => {
    const live = !!req.live && !!cfg.serpApiKey;
    const stores = fsStores({
      fixturesDir: cfg.fixturesDir,
      imageCacheDir: cfg.imageCacheDir,
      ...(live && cfg.serpApiKey && { serpApiKey: cfg.serpApiKey }),
    });
    // Image transcriptions are saved separately, so the vision model is the uncached client.
    return { llm, vision: gemini, model: cfg.model, ...stores, ...(db && { intentSets: dbIntentSets(db, stores.intentSets) }), images: gemini ? stores.images : null };
  };
}
