import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { AUDIT_QUEUE, DEFAULT_REDIS_PREFIX, type AuditJobData } from "./queue";
import { processAudit, type ProcessorContext, type ProcessResult } from "./processor";

export type WorkerOptions = ProcessorContext & {
  connection: Redis;
  prefix?: string;
  /** Audits run one at a time by default: the model's rate limit is the bottleneck anyway. */
  concurrency?: number;
};

export function startWorker(o: WorkerOptions): Worker<AuditJobData, ProcessResult> {
  const worker = new Worker<AuditJobData, ProcessResult>(AUDIT_QUEUE, (job, token) => processAudit(job, token, o), {
    connection: o.connection,
    prefix: o.prefix ?? DEFAULT_REDIS_PREFIX,
    concurrency: o.concurrency ?? 1,
  });
  // Without a listener, an error event (e.g. Redis dropping) would crash the process.
  worker.on("error", (err) => o.log?.(`worker error: ${err.message}`));
  return worker;
}
