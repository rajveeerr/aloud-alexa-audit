import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import type { PastedListing } from "@answerable/core";
import { getAudit, markDone, markFailed, markQueued, markRunning, saveSnapshot, type AuditRow, type Db } from "@answerable/db";
import { runAudit, type AuditDeps, type AuditRequest, type AuditResult } from "@answerable/pipeline";
import { classify } from "./errors";
import type { AuditJobData } from "./queue";
import { nextQuotaReset } from "./quota";
import { sendWebhook, type WebhookConfig } from "./webhook";

export type ProcessorContext = {
  db: Db;
  makeDeps: (req: AuditRequest) => AuditDeps;
  webhook?: WebhookConfig | null;
  log?: (message: string) => void;
  now?: () => Date;
};

export type ProcessResult = { skipped: "missing" | "done" | "failed" } | { score: number | null };

/** The stored request, back in the shape runAudit takes. */
export function toAuditRequest(row: Pick<AuditRow, "requestedAsin" | "source" | "request">): AuditRequest {
  const r = row.request as { paste?: PastedListing; category?: string; competitors?: string[]; live?: boolean };
  return {
    asin: row.requestedAsin,
    source: row.source,
    live: r.live ?? false,
    ...(r.paste && { paste: r.paste }),
    ...(r.category && { category: r.category }),
    ...(r.competitors?.length && { competitors: r.competitors }),
  };
}

/**
 * Runs one queued audit. Safe to run twice: a done or failed audit is left alone, and a
 * "running" one (a worker died mid-job) simply runs again.
 */
export async function processAudit(job: Job<AuditJobData>, token: string | undefined, ctx: ProcessorContext): Promise<ProcessResult> {
  const log = ctx.log ?? (() => {});
  const row = await getAudit(ctx.db, job.data.auditId);
  if (!row) return { skipped: "missing" };
  if (row.status === "done" || row.status === "failed") return { skipped: row.status };

  await markRunning(ctx.db, row.id);
  const req = toAuditRequest(row);
  let result: AuditResult;
  try {
    result = await runAudit(req, ctx.makeDeps(req));
  } catch (err) {
    const action = classify(err);
    if (action.kind === "quota") {
      const at = nextQuotaReset(ctx.now?.() ?? new Date());
      await markQueued(ctx.db, row.id, `Waiting for the model's daily quota to reset at ${at.toISOString()}.`);
      log(`audit ${row.id}: quota exhausted, delayed until ${at.toISOString()}`);
      // Delaying isn't a failure, so it doesn't use up one of the job's attempts.
      await job.moveToDelayed(at.getTime(), token);
      throw new DelayedError();
    }
    const lastAttempt = action.kind === "fail" || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (lastAttempt) {
      await markFailed(ctx.db, row.id, { code: action.code, message: action.message });
      log(`audit ${row.id}: failed (${action.code}) ${action.message}`);
      if (action.kind === "fail") throw new UnrecoverableError(action.message);
    } else {
      await markQueued(ctx.db, row.id, `Attempt ${job.attemptsMade + 1} failed (${action.message}); retrying.`);
      log(`audit ${row.id}: attempt ${job.attemptsMade + 1} failed, retrying: ${action.message}`);
    }
    throw err;
  }

  await saveResult(ctx.db, row.id, result);
  log(`audit ${row.id}: done, score ${result.score.score}`);
  if (ctx.webhook) {
    const event = { type: "audit.completed" as const, auditId: row.id, asin: result.listing.asin, score: result.score.score };
    sendWebhook(ctx.webhook, event).catch((err) => log(`audit ${row.id}: webhook failed: ${(err as Error).message}`));
  }
  return { score: result.score.score };
}

async function saveResult(db: Db, id: string, r: AuditResult): Promise<void> {
  const l = r.listing;
  await saveSnapshot(db, { asin: l.asin, source: l.source, contentHash: l.contentHash, fields: l.fields, meta: l.meta, fetchedAt: new Date(l.fetchedAt) });
  await markDone(db, id, {
    asin: l.asin,
    score: r.score.score,
    basis: r.intentSet.basis,
    categoryId: r.intentSet.categoryId,
    categoryName: r.intentSet.categoryName,
    brand: l.meta.brand ?? null,
    title: l.fields.find((f) => f.id === "title")?.text ?? null,
    contentHash: l.contentHash,
    report: r,
    usage: r.usage,
  });
}
