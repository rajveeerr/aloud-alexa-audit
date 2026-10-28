#!/usr/bin/env bun
/** bun run api [--with-worker]: the HTTP API, optionally with the audit worker in the same process. */
import { configFromEnv, startServer } from "./server";

const cfg = configFromEnv();
const server = await startServer(cfg);
console.log(`api listening on ${server.url}${cfg.runWorker ? " with the worker" : ""}`);

async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
