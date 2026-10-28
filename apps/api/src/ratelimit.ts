import type { Redis } from "ioredis";

export type Hit = { allowed: boolean; remaining: number; retryAfterSec: number };

/**
 * Fixed-window counter in Redis, so the limit holds across API instances and restarts.
 * INCR, EXPIRE NX and TTL go in one MULTI: the window starts with the first request and a
 * crash between the steps can't leave a counter that never expires.
 */
export async function hit(redis: Redis, key: string, limit: number, windowSec: number): Promise<Hit> {
  const res = await redis.multi().incr(key).expire(key, windowSec, "NX").ttl(key).exec();
  const count = Number(res?.[0]?.[1] ?? 0);
  const ttl = Number(res?.[2]?.[1] ?? windowSec);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: ttl > 0 ? ttl : windowSec };
}
