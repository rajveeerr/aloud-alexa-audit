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
