import type { Query } from "@tanstack/react-query";
import { nextPoll, type PollError } from "./poll";

const streaks = new WeakMap<object, { at: number; n: number }>();

/** Consecutive failed fetches of a query. React Query resets its own count on every fetch, so it's tracked here. */
function failuresInARow(q: Query<any, any, any, any>): number {
  const s = q.state;
  if (s.status !== "error" || s.dataUpdatedAt > s.errorUpdatedAt) {
    streaks.delete(q);
    return 0;
  }
  const seen = streaks.get(q);
  if (seen?.at === s.errorUpdatedAt) return seen.n;
  const n = (seen?.n ?? 0) + 1;
  streaks.set(q, { at: s.errorUpdatedAt, n });
  return n;
}

function asPollError(e: unknown): PollError {
  const err = e as { status?: unknown; retryAfterMs?: unknown } | null;
  return {
    status: typeof err?.status === "number" ? err.status : 0,
    retryAfterMs: typeof err?.retryAfterMs === "number" ? err.retryAfterMs : undefined,
  };
}

/**
 * refetchInterval for a job that settles: keeps polling through a failed fetch (backing off, and
 * honouring Retry-After), stops once settled, on an error a retry can't fix, or past the cap.
 */
export function pollUntil<T>(settled: (d: T) => boolean, createdAt: (d: T) => string | number | undefined, every?: number) {
  return (q: Query<T, any, any, any>): number | false => {
    const d = q.state.data;
    const failing = q.state.status === "error";
    return nextPoll({
      settled: d !== undefined && settled(d),
      createdAt: d === undefined ? undefined : createdAt(d),
      error: failing ? asPollError(q.state.error) : null,
      failures: failuresInARow(q),
      ...(every !== undefined && { every }),
    });
  };
}
