import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
import { findApiKey, type Db } from "@answerable/db";
import { HttpError } from "./errors";
import { hit } from "./ratelimit";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * x-api-key, compared by SHA-256 against api_keys. Hashing first means the lookup is an exact
 * match on a fixed-length value and the table never holds a usable key. Each key also has its
 * own per-minute limit.
 */
export function requireApiKey(db: Db, redis: Redis, prefix: string): RequestHandler {
  return async (req, res, next) => {
    const key = req.get("x-api-key");
    if (!key) throw new HttpError(401, "unauthorized", "Missing x-api-key header");
    const row = await findApiKey(db, hashKey(key));
    if (!row) throw new HttpError(401, "unauthorized", "Invalid API key");

    const h = await hit(redis, `${prefix}:rl:key:${row.id}`, row.rateLimit, 60);
    res.set("X-RateLimit-Limit", String(row.rateLimit));
    res.set("X-RateLimit-Remaining", String(h.remaining));
    if (!h.allowed) {
      res.set("Retry-After", String(h.retryAfterSec));
      throw new HttpError(429, "rate_limited", `Rate limit of ${row.rateLimit} requests a minute reached`);
    }
    next();
  };
}
