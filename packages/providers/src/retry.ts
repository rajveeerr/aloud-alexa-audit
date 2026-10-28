import { ProviderError } from "./types";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * For long recording runs on the free tier (10 requests a minute): six tries, backing off from
 * 5 s up to a minute, so a per-minute 429 or a 503 "high demand" waits it out instead of failing.
 */
export const PATIENT_RETRY: RetryOptions = { attempts: 6, baseDelayMs: 5000 };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retries only errors marked retryable (429, 5xx, network), with exponential backoff and jitter. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 2000;
  const max = opts.maxDelayMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;

  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof ProviderError && err.retryable;
      if (!retryable || i >= attempts) throw err;
      const delay = Math.min(max, base * 2 ** (i - 1));
      await sleep(delay / 2 + Math.random() * (delay / 2));
    }
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
