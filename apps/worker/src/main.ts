#!/usr/bin/env bun
/** bun run worker: processes the audits queue on its own. The API can also run it in-process. */
import { connect } from "@answerable/db";
import { depsConfigFromEnv, makeDeps } from "./deps";
import { webhookFromEnv } from "./env";
import { redisConnection } from "./queue";
import { startWorker } from "./worker";

const { db, close } = connect();
const connection = redisConnection();
const cfg = depsConfigFromEnv();
const worker = startWorker({
  db,
  connection,
  ...(process.env.REDIS_PREFIX && { prefix: process.env.REDIS_PREFIX }),
  makeDeps: makeDeps(cfg),
  webhook: webhookFromEnv(),
  log: (m) => console.log(m),
});
console.log(`worker running (${cfg.geminiApiKey ? "recording new model calls" : "replay only"}, ${cfg.geminiRpm} rpm)`);

async function shutdown() {
  await worker.close();
  await connection.quit();
  await close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
