import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import type { PastedListing } from "@answerable/core";
import { getAudit, markDone, markFailed, markQueued, markRunning, saveSnapshot, type AuditRow, type Db } from "@answerable/db";
import { runAudit, type AuditDeps, type AuditRequest, type AuditResult } from "@answerable/pipeline";
import { classify, type ErrorAction } from "./errors";
import type { AuditJobData } from "./queue";
import { nextQuotaReset } from "./quota";
import { sendWebhook, type AuditEvent, type WebhookConfig } from "./webhook";

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

const errorText = (err: unknown) => (err instanceof Error ? (err.stack ?? err.message) : String(err));

/**
 * Runs one queued audit. Safe to run twice: a done or failed audit is left alone, and a
 * "running" one (a worker died mid-job) simply runs again.
 *
 * Everything after the idempotency check sits inside one try, so a database error while
 * saving is classified like any other failure and the row never stays "running".
 */
export async function processAudit(job: Job<AuditJobData>, token: string | undefined, ctx: ProcessorContext): Promise<ProcessResult> {
  const log = ctx.log ?? (() => {});
  const row = await getAudit(ctx.db, job.data.auditId);
  if (!row) return { skipped: "missing" };
  if (row.status === "done" || row.status === "failed") return { skipped: row.status };

  let result: AuditResult;
  try {
    await markRunning(ctx.db, row.id);
    const req = toAuditRequest(row);
    result = await runAudit(req, ctx.makeDeps(req));
    await saveResult(ctx.db, row.id, result);
  } catch (err) {
    return handleFailure(job, token, row, err, ctx);
  }

  log(`audit ${row.id}: done, score ${result.score.score}`);
  notify(ctx, { type: "audit.completed", auditId: row.id, asin: result.listing.asin, score: result.score.score });
  return { score: result.score.score };
}

async function handleFailure(job: Job<AuditJobData>, token: string | undefined, row: AuditRow, err: unknown, ctx: ProcessorContext): Promise<never> {
  const log = ctx.log ?? (() => {});
  const action = classify(err);
  // Logged first, in full, so it's never lost if recording the failure fails too.
  log(`audit ${row.id}: attempt ${job.attemptsMade + 1} failed (${action.code}): ${errorText(err)}`);

  if (action.kind === "quota") {
    const at = nextQuotaReset(ctx.now?.() ?? new Date());
    await record(log, row.id, () => markQueued(ctx.db, row.id, `Waiting for the model's daily quota to reset at ${at.toISOString()}.`));
    log(`audit ${row.id}: quota exhausted, delayed until ${at.toISOString()}`);
    // Delaying isn't a failure, so it doesn't use up one of the job's attempts.
    await job.moveToDelayed(at.getTime(), token);
    throw new DelayedError();
  }

  if (action.kind === "fail") {
    await failAudit(ctx, row, action);
    throw new UnrecoverableError(action.message);
  }

  if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await failAudit(ctx, row, action);
  else await record(log, row.id, () => markQueued(ctx.db, row.id, `Attempt ${job.attemptsMade + 1} failed (${action.message}); retrying.`));
  throw err;
}

/** Runs a status write; if it throws, logs that and carries on so the original error still surfaces. */
async function record(log: (m: string) => void, id: string, write: () => Promise<void>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (e) {
    log(`audit ${id}: couldn't record its status: ${errorText(e)}`);
    return false;
  }
}

async function failAudit(ctx: ProcessorContext, row: Pick<AuditRow, "id" | "asin">, action: Pick<ErrorAction, "code" | "message">): Promise<void> {
  const log = ctx.log ?? (() => {});
  const error = { code: action.code, message: action.message };
  if (await record(log, row.id, () => markFailed(ctx.db, row.id, error))) {
    notify(ctx, { type: "audit.failed", auditId: row.id, asin: row.asin, error });
  }
}

/**
 * The worker's "failed" listener. The processor marks its own failures, but BullMQ also fails
 * jobs without running the processor (a job that stalled too often), and a status write can
 * fail. Once a job has no attempts left, any audit not yet done or failed is marked failed here.
 */
export async function onJobFailed(job: Job<AuditJobData> | undefined, err: Error, ctx: ProcessorContext): Promise<void> {
  if (!job) return;
  const final = err.name === "UnrecoverableError" || job.attemptsMade >= (job.opts.attempts ?? 1) || /stalled/i.test(err.message);
  if (!final) return;
  const row = await getAudit(ctx.db, job.data.auditId);
  if (!row || row.status === "done" || row.status === "failed") return;
  const action = /stalled/i.test(err.message)
    ? { code: "stalled", message: "The worker stopped while running this audit too many times." }
    : err.name === "UnrecoverableError"
      ? { code: "internal", message: err.message }
      : classify(err);
  await failAudit(ctx, row, action);
}

/** Fire and forget: a slow or broken receiver must never hold up or fail an audit. */
function notify(ctx: ProcessorContext, event: AuditEvent): void {
  const hook = ctx.webhook;
  if (!hook) return;
  sendWebhook(hook, event).catch((err) => ctx.log?.(`webhook ${event.type} for ${event.auditId} to ${hook.url} failed: ${(err as Error).message}`));
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
