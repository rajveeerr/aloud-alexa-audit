/**
 * When to poll next. Plain functions, no React or Vite, so they're unit tested with bun test.
 *
 * - Settled (done, failed) stops.
 * - Past the cap since the job was created stops; the page offers a manual refresh instead.
 * - An error that a retry can fix (network, 429, 5xx) backs off, honouring Retry-After;
 *   one that can't (400, 401, 403, 404) stops.
 */
export const POLL_MS = 1500;
export const MAX_BACKOFF_MS = 30_000;
export const POLL_CAP_MS = 15 * 60_000;

export type PollError = { status: number; retryAfterMs?: number | undefined };

export function isTransient(e: PollError): boolean {
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

/** True once a job has been polled for longer than the cap without settling. */
export function pastCap(createdAt: string | number | undefined, now = Date.now(), cap = POLL_CAP_MS): boolean {
  if (createdAt === undefined) return false;
  const t = typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  return Number.isFinite(t) && now - t > cap;
}

export function nextPoll(s: {
  settled: boolean;
  createdAt?: string | number | undefined;
  /** The last fetch's error, if it failed. */
  error?: PollError | null | undefined;
  /** Consecutive failed fetches. */
  failures?: number;
  now?: number;
  every?: number;
}): number | false {
  const every = s.every ?? POLL_MS;
  if (s.settled) return false;
  if (pastCap(s.createdAt, s.now)) return false;
  if (!s.error) return every;
  if (!isTransient(s.error)) return false;
  if (s.error.retryAfterMs !== undefined) return Math.min(Math.max(s.error.retryAfterMs, every), MAX_BACKOFF_MS * 4);
  return Math.min(every * 2 ** Math.max(0, (s.failures ?? 1) - 1), MAX_BACKOFF_MS);
}

/** Retry-After is seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
