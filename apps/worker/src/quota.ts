/**
 * Gemini's free-tier daily quotas reset at midnight US Pacific, not UTC. A job that ran out of
 * quota waits until then: retrying sooner would only burn attempts on the same 429.
 */
const ZONE = "America/Los_Angeles";

/** A minute past midnight, so a job never wakes a moment before the quota is actually back. */
const MARGIN_MS = 60_000;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallClock(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, second: p.second! };
}

/** Pacific wall-clock time minus UTC at that instant: -7 h in summer, -8 h in winter. */
function offsetMs(d: Date): number {
  const w = wallClock(d);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The next midnight in Pacific time after `now`, plus a small margin. */
export function nextQuotaReset(now: Date): Date {
  const w = wallClock(now);
  // Tomorrow 00:00 written as if it were UTC, then shifted by the Pacific offset. The offset is
  // taken again at the guess because a DST change between now and midnight moves it by an hour.
  const midnight = Date.UTC(w.year, w.month - 1, w.day + 1);
  let at = midnight - offsetMs(now);
  at = midnight - offsetMs(new Date(at));
  return new Date(at + MARGIN_MS);
}
