import type { Queue } from "bullmq";
import type { RescoreResult } from "@aloud/contracts";
import { normalize } from "@aloud/core";
import { createAudit, createBulk, latestDone, markManyFailed, pendingAudit, type AuditRow, type Db, type NewAudit } from "@aloud/db";
import { AuditError, type ListingStore } from "@aloud/pipeline";
import { enqueueAudits, type AuditJobData } from "./queue";

export type JobsContext = { db: Db; queue: Queue<AuditJobData>; log?: (message: string) => void };

/** The audit rows were saved but their jobs couldn't be queued; the rows are already marked failed. */
export class EnqueueError extends Error {
  constructor(
    readonly auditIds: string[],
    override readonly cause: unknown,
  ) {
    super("Couldn't queue the audit; the queue is unavailable. Try again shortly.");
    this.name = "EnqueueError";
  }
}

const ENQUEUE_TIMEOUT_MS = 5_000;

/**
 * Queues jobs for rows that already exist. If Redis can't take them, the rows are marked
 * failed (enqueue_failed) instead of sitting "queued" forever with no job behind them, and
 * a bulk job built from them still finishes.
 */
async function enqueueOrFail(ctx: JobsContext, auditIds: string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("Enqueue timed out")), ENQUEUE_TIMEOUT_MS)));
    await Promise.race([enqueueAudits(ctx.queue, auditIds), timeout]);
  } catch (err) {
    ctx.log?.(`couldn't enqueue ${auditIds.length} audit(s): ${(err as Error).stack ?? String(err)}`);
    await markManyFailed(ctx.db, auditIds, { code: "enqueue_failed", message: "The audit couldn't be queued. Try again." }).catch((e) =>
      ctx.log?.(`couldn't mark unqueued audits failed: ${(e as Error).message}`),
    );
    throw new EnqueueError(auditIds, err);
  } finally {
    clearTimeout(timer);
  }
}

/** Saves the audit row first, then the job, so the worker always finds the row it's given. */
export async function submitAudit(ctx: JobsContext, a: NewAudit): Promise<AuditRow> {
  const row = await createAudit(ctx.db, a);
  await enqueueOrFail(ctx, [row.id]);
  return row;
}

/**
 * The listing-changed webhook. Re-auditing costs model calls, so it only happens when the
 * listing's content hash differs from the last finished audit's, and never twice at once:
 * an audit of the listing that's already queued or running is returned instead.
 * Reads the saved listing.
 */
export async function rescore(
  ctx: JobsContext & { listings: ListingStore },
  r: { asin: string; source: "serpapi" | "dataset"; reason: string },
): Promise<RescoreResult> {
  const raw = await ctx.listings.get(r.source, r.asin);
  if (!raw) throw new AuditError(`No ${r.source} listing for ${r.asin}`, "listing_not_found");
  const hash = normalize(raw).contentHash;

  const pending = await pendingAudit(ctx.db, r.asin, r.source);
  if (pending) return { skipped: false, auditId: pending.id };
  const last = await latestDone(ctx.db, r.asin, r.source);
  if (last && last.contentHash === hash) return { skipped: true, reason: "unchanged", auditId: last.id };

  const row = await submitAudit(ctx, { asin: r.asin, source: r.source, origin: "rescore", request: { live: false, reason: r.reason } });
  return { skipped: false, auditId: row.id };
}

/** One audit per ASIN, all linked to the bulk job. Progress is read from the audits' statuses. */
export async function startBulk(
  ctx: JobsContext,
  b: { name: string; asins: string[]; source: "serpapi" | "dataset"; live: boolean },
): Promise<{ id: string }> {
  const asins = [...new Set(b.asins)];
  const { id, auditIds } = await createBulk(ctx.db, { name: b.name, source: b.source, asins, request: { live: b.live } });
  await enqueueOrFail(ctx, auditIds);
  return { id };
}
