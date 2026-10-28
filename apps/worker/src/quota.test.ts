import { describe, expect, test } from "bun:test";
import { nextQuotaReset } from "./quota";

const reset = (iso: string) => nextQuotaReset(new Date(iso)).toISOString();

describe("nextQuotaReset", () => {
  test("summer: midnight PDT is 07:00 UTC", () => {
    expect(reset("2026-10-30T12:00:00Z")).toBe("2026-10-31T07:01:00.000Z");
  });

  test("late evening Pacific is already the next UTC day", () => {
    // 2026-10-30 22:30 PDT
    expect(reset("2026-10-31T05:30:00Z")).toBe("2026-10-31T07:01:00.000Z");
  });

  test("winter: midnight PST is 08:00 UTC", () => {
    expect(reset("2026-12-15T20:00:00Z")).toBe("2026-12-16T08:01:00.000Z");
  });

  test("the night DST ends uses the offset at midnight, not now", () => {
    // 2026-11-01 01:30 PDT, DST ends at 02:00; the next midnight is PST
    expect(reset("2026-11-01T08:30:00Z")).toBe("2026-11-02T08:01:00.000Z");
  });

  test("the night DST starts", () => {
    // 2026-03-08 01:00 PST, clocks jump at 02:00; the next midnight is PDT
    expect(reset("2026-03-08T09:00:00Z")).toBe("2026-03-09T07:01:00.000Z");
  });

  test("exactly midnight waits for the next one", () => {
    expect(reset("2026-10-31T07:00:00Z")).toBe("2026-11-01T07:01:00.000Z");
  });
});
