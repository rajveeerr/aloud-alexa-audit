import type { Redis } from "ioredis";

export type Hit = { allowed: boolean; remaining: number; retryAfterSec: number };

/**
 * INCR, then start the window's expiry on the first hit, then read the TTL, all in one script.
 * Running it in Redis keeps the steps atomic, so a crash between them can't leave a counter that
 * never expires. (A MULTI would too, but its rejection path breaks under Bun 1.1 when Redis is down.)
 */
const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('TTL', KEYS[1])}
`;

/** Fixed-window counter in Redis, so the limit holds across API instances and restarts. */
export async function hit(redis: Redis, key: string, limit: number, windowSec: number): Promise<Hit> {
  const [count, ttl] = (await redis.eval(SCRIPT, 1, key, String(windowSec))) as [number, number];
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: ttl > 0 ? ttl : windowSec };
}

/** Seconds left in the current UTC day, at least 1. */
export function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export type DailySlot = { allowed: boolean; retryAfterSec: number; release: () => Promise<void> };

/**
 * Takes one of today's `limit` slots from a counter shared by every API instance. The key carries
 * the UTC date and expires a day after that date ends, so each day starts at 0. A refused slot is
 * given back at once, and `release` gives back a taken one (when the work it was for never started).
 */
export async function takeDaily(redis: Redis, keyBase: string, limit: number, now: Date = new Date()): Promise<DailySlot> {
  const key = `${keyBase}:${now.toISOString().slice(0, 10)}`;
  const left = secondsToUtcMidnight(now);
  const h = await hit(redis, key, limit, left + 86_400);
  const release = async () => {
    await redis.decr(key);
  };
  if (!h.allowed) await release();
  return { allowed: h.allowed, retryAfterSec: left, release };
}
