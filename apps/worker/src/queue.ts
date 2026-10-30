import { Queue, type JobsOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";

export const AUDIT_QUEUE = "audits";

export type AuditJobData = { auditId: string };

export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6389";

/** Every key this app writes starts with it, so a shared Redis (or a test run) stays separate. */
export const DEFAULT_REDIS_PREFIX = "aloud";

/**
 * For the worker only. BullMQ needs maxRetriesPerRequest null there so its blocking commands
 * wait out a Redis restart instead of erroring.
 */
export function workerRedisConnection(url = process.env.REDIS_URL || DEFAULT_REDIS_URL): Redis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/**
 * For request handlers and enqueueing. Commands fail fast while Redis is down (one retry,
 * a 3 s cap) so an HTTP request answers 503 instead of hanging until Redis comes back.
 */
export function redisConnection(url = process.env.REDIS_URL || DEFAULT_REDIS_URL): Redis {
  return new IORedis(url, { maxRetriesPerRequest: 1, commandTimeout: 3_000 });
}

/** ioredis errors that mean Redis is unreachable, not that a command was wrong. */
export function isRedisDown(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "MaxRetriesPerRequestError" ||
    /Command timed out|Connection is closed|Stream isn't writeable|ECONNREFUSED|Reached the max retries/i.test(err.message)
  );
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
    prefix: o.prefix ?? DEFAULT_REDIS_PREFIX,
    defaultJobOptions: jobOptions(o.backoffMs ?? 10_000),
  });
}

export async function enqueueAudits(queue: Queue<AuditJobData>, auditIds: string[]): Promise<void> {
  await queue.addBulk(auditIds.map((auditId) => ({ name: "audit", data: { auditId }, opts: { jobId: auditId } })));
}
