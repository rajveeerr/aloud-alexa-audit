import { expect, test } from "bun:test";
import type { Redis } from "ioredis";
import { redisConnection, workerRedisConnection } from "./queue";

/** Builds a connection, reads its options and drops it before it gets anywhere. */
function optionsOf(make: () => Redis) {
  const r = make();
  r.on("error", () => {});
  const o = r.options;
  r.disconnect();
  return o;
}

// Upstash only takes TLS connections, given as a rediss:// URL.
const UPSTASH = "rediss://default:secret@example-12345.upstash.io:6379";

test("a rediss:// URL connects over TLS, for both the API and the worker", () => {
  for (const make of [() => redisConnection(UPSTASH), () => workerRedisConnection(UPSTASH)]) {
    const o = optionsOf(make);
    expect(o.tls).toBeDefined();
    expect(o.host).toBe("example-12345.upstash.io");
    expect(o.password).toBe("secret");
  }
});

test("a redis:// URL stays plain TCP", () => {
  expect(optionsOf(() => redisConnection("redis://127.0.0.1:6389")).tls).toBeUndefined();
});

test("the worker's connection never gives up on a command, as BullMQ requires; the API's fails fast", () => {
  expect(optionsOf(() => workerRedisConnection(UPSTASH)).maxRetriesPerRequest).toBeNull();
  expect(optionsOf(() => redisConnection(UPSTASH)).maxRetriesPerRequest).toBe(1);
});
