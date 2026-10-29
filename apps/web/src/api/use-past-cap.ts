import { useEffect, useState } from "react";
import { pastCap, POLL_CAP_MS } from "./poll";

/**
 * True once a still-pending job is older than the polling cap. Polling stops at that point, so
 * nothing else would re-render the page: a timer flips this at the right moment.
 */
export function usePastCap(createdAt: string | number | null | undefined, pending: boolean): boolean {
  const [, rerender] = useState(0);
  const start = createdAt === null || createdAt === undefined ? NaN : typeof createdAt === "number" ? createdAt : Date.parse(createdAt);

  useEffect(() => {
    if (!pending || !Number.isFinite(start)) return;
    const wait = start + POLL_CAP_MS - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => rerender((n) => n + 1), wait + 50);
    return () => clearTimeout(t);
  }, [start, pending]);

  return pending && Number.isFinite(start) && pastCap(start);
}
