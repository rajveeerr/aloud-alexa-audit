import { describe, expect, test } from "bun:test";
import { MAX_BACKOFF_MS, nextPoll, parseRetryAfter, pastCap, POLL_CAP_MS, POLL_MS } from "./poll";

const now = Date.parse("2026-10-30T12:00:00Z");
const created = new Date(now - 60_000).toISOString();

describe("nextPoll", () => {
  test("polls while running and stops once settled", () => {
    expect(nextPoll({ settled: false, createdAt: created, now })).toBe(POLL_MS);
    expect(nextPoll({ settled: true, createdAt: created, now })).toBe(false);
  });

  test("a failed poll keeps polling with backoff instead of giving up", () => {
    const err = { status: 503 };
    expect(nextPoll({ settled: false, createdAt: created, now, error: err, failures: 1 })).toBe(POLL_MS);
    expect(nextPoll({ settled: false, createdAt: created, now, error: err, failures: 3 })).toBe(POLL_MS * 4);
    expect(nextPoll({ settled: false, createdAt: created, now, error: err, failures: 20 })).toBe(MAX_BACKOFF_MS);
    expect(nextPoll({ settled: false, createdAt: created, now, error: { status: 0 }, failures: 1 })).toBe(POLL_MS);
  });

  test("a 429 waits as long as Retry-After says", () => {
    expect(nextPoll({ settled: false, createdAt: created, now, error: { status: 429, retryAfterMs: 12_000 }, failures: 1 })).toBe(12_000);
  });

  test("errors a retry can't fix stop polling", () => {
    for (const status of [400, 401, 403, 404]) expect(nextPoll({ settled: false, createdAt: created, now, error: { status }, failures: 1 })).toBe(false);
  });

  test("stops after the cap since the job was created", () => {
    const old = new Date(now - POLL_CAP_MS - 1).toISOString();
    expect(nextPoll({ settled: false, createdAt: old, now })).toBe(false);
    expect(pastCap(old, now)).toBe(true);
    expect(pastCap(created, now)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  test("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("7", now)).toBe(7000);
    expect(parseRetryAfter(new Date(now + 5000).toUTCString(), now)).toBe(5000);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });
});
