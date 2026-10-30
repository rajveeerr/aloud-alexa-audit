#!/usr/bin/env bun
/** bun run worker: processes the audits queue on its own. The API can also run it in-process. */
import { connect } from "@aloud/db";
import { depsConfigFromEnv, makeDeps } from "./deps";
import { webhookFromEnv } from "./env";
import { onShutdown } from "./shutdown";
import { startWorker } from "./worker";

const log = (m: string) => console.log(m);
const { db, close } = connect();
const cfg = depsConfigFromEnv();
const worker = startWorker({
  db,
  ...(process.env.REDIS_PREFIX && { prefix: process.env.REDIS_PREFIX }),
  makeDeps: makeDeps(cfg),
  webhook: webhookFromEnv(),
  log,
});
console.log(`worker running (${cfg.geminiApiKey ? "recording new model calls" : "replay only"}, ${cfg.geminiRpm} rpm)`);

onShutdown(async () => {
  await worker.close();
  await close();
}, log);
