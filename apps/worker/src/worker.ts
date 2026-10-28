import { Worker } from "bullmq";
import { AUDIT_QUEUE, DEFAULT_REDIS_PREFIX, workerRedisConnection, type AuditJobData } from "./queue";
import { onJobFailed, processAudit, type ProcessorContext, type ProcessResult } from "./processor";

export type WorkerOptions = ProcessorContext & {
  redisUrl?: string;
  prefix?: string;
  /** Audits run one at a time by default: the model's rate limit is the bottleneck anyway. */
  concurrency?: number;
};

export type RunningWorker = { worker: Worker<AuditJobData, ProcessResult>; close: () => Promise<void> };

/** The worker owns its Redis connection (it blocks on it), so close() quits that too. */
export function startWorker(o: WorkerOptions): RunningWorker {
  const log = o.log ?? (() => {});
  const connection = workerRedisConnection(o.redisUrl);
  const worker = new Worker<AuditJobData, ProcessResult>(AUDIT_QUEUE, (job, token) => processAudit(job, token, o), {
    connection,
    prefix: o.prefix ?? DEFAULT_REDIS_PREFIX,
    concurrency: o.concurrency ?? 1,
  });
  // Without a listener, an error event (e.g. Redis dropping) would crash the process.
  worker.on("error", (err) => log(`worker error: ${err.message}`));
  worker.on("failed", (job, err) => {
    onJobFailed(job, err, o).catch((e) => log(`couldn't mark failed job ${job?.id}: ${(e as Error).message}`));
  });
  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
