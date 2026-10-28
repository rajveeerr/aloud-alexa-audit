#!/usr/bin/env bun
/** bun run api [--with-worker]: the HTTP API, optionally with the audit worker in the same process. */
import { onShutdown } from "@answerable/worker";
import { configFromEnv, startServer } from "./server";

const log = (m: string) => console.log(m);
const cfg = configFromEnv();
const server = await startServer(cfg, { log });
console.log(`api listening on ${server.url}${cfg.runWorker ? " with the worker" : ""}`);
if (!cfg.devApiKey) console.log("no dev API key seeded (set API_KEY_DEV outside production to add one)");

onShutdown(() => server.close(), log);
