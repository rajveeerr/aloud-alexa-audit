import { Queue, type JobsOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";

export const AUDIT_QUEUE = "audits";

export type AuditJobData = { auditId: string };

export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6389";

/** BullMQ needs maxRetriesPerRequest null so its blocking commands wait instead of erroring. */
export function redisConnection(url = process.env.REDIS_URL ?? DEFAULT_REDIS_URL): Redis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/**
 * Three attempts with exponential backoff for transient failures. Failed jobs are kept:
 * BullMQ's failed set is the dead-letter list. The job id is the audit id, so enqueueing the
 * same audit twice is a no-op.
 */
export function jobOptions(backoffMs: number): JobsOptions {
  return {
    attempts: 3,
    backoff: { type: "exponential", delay: backoffMs },
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  };
}

export type QueueOptions = { connection: Redis; prefix?: string; backoffMs?: number };

export function createAuditQueue(o: QueueOptions): Queue<AuditJobData> {
  return new Queue<AuditJobData>(AUDIT_QUEUE, {
    connection: o.connection,
    ...(o.prefix && { prefix: o.prefix }),
    defaultJobOptions: jobOptions(o.backoffMs ?? 10_000),
  });
}

export async function enqueueAudits(queue: Queue<AuditJobData>, auditIds: string[]): Promise<void> {
  await queue.addBulk(auditIds.map((auditId) => ({ name: "audit", data: { auditId }, opts: { jobId: auditId } })));
}
