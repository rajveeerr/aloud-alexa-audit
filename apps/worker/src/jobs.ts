import type { Queue } from "bullmq";
import type { RescoreResult } from "@answerable/contracts";
import { normalize } from "@answerable/core";
import { createAudit, createBulk, latestDone, type AuditRow, type Db, type NewAudit } from "@answerable/db";
import { AuditError, type ListingStore } from "@answerable/pipeline";
import { enqueueAudits, type AuditJobData } from "./queue";

export type JobsContext = { db: Db; queue: Queue<AuditJobData> };

/** Saves the audit row first, then the job, so the worker always finds the row it's given. */
export async function submitAudit(ctx: JobsContext, a: NewAudit): Promise<AuditRow> {
  const row = await createAudit(ctx.db, a);
  await enqueueAudits(ctx.queue, [row.id]);
  return row;
}

/**
 * The listing-changed webhook. Re-auditing costs model calls, so it only happens when the
 * listing's content hash differs from the last finished audit's. Reads the saved listing.
 */
export async function rescore(
  ctx: JobsContext & { listings: ListingStore },
  r: { asin: string; source: "serpapi" | "dataset"; reason: string },
): Promise<RescoreResult> {
  const raw = await ctx.listings.get(r.source, r.asin);
  if (!raw) throw new AuditError(`No ${r.source} listing for ${r.asin}`, "listing_not_found");
  const hash = normalize(raw).contentHash;
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
  await enqueueAudits(ctx.queue, auditIds);
  return { id };
}
