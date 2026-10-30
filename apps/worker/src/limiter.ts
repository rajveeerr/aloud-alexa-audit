import type { LlmProvider } from "@aloud/providers";

/**
 * Spaces real model calls to stay under a requests-per-minute cap (free-tier Flash-Lite is about 10).
 * It wraps the uncached client, so replayed calls are never slowed down, and it limits calls
 * rather than jobs because one audit makes several calls (one per listing graded, plus coverage
 * and briefs). One limiter per process: run a single worker per API key.
 */
export function rateLimited(
  inner: LlmProvider,
  rpm: number,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): LlmProvider {
  const gap = 60_000 / rpm;
  let next = 0;
  return {
    name: inner.name,
    async generateJson(req) {
      const now = clock.now();
      const wait = Math.max(0, next - now);
      next = Math.max(now, next) + gap;
      if (wait > 0) await clock.sleep(wait);
      return inner.generateJson(req);
    },
  };
}
