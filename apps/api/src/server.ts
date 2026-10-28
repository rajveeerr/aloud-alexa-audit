import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Worker } from "bullmq";
import { connect, DEFAULT_DATABASE_URL, ensureApiKey } from "@answerable/db";
import { fsStores, type AuditDeps, type AuditRequest } from "@answerable/pipeline";
import {
  createAuditQueue,
  DEFAULT_REDIS_PREFIX,
  DEFAULT_REDIS_URL,
  depsConfigFromEnv,
  makeDeps,
  redisConnection,
  startWorker,
  webhookFromEnv,
  type WebhookConfig,
} from "@answerable/worker";
import { createApp, type AppConfig } from "./app";
import { hashKey } from "./auth";

export type ServerConfig = AppConfig & {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Run the audit worker in this process too: the single free-tier service deploy. */
  runWorker: boolean;
  /** Seeded as an API key on startup outside production. */
  devApiKey: string | null;
  fixturesDir: string;
  webhook: WebhookConfig | null;
  /** Retry backoff for failed audits. */
  backoffMs: number;
};

export function configFromEnv(env: Record<string, string | undefined> = process.env, argv: string[] = process.argv): ServerConfig {
  const production = env.NODE_ENV === "production";
  const trust = env.TRUST_PROXY;
  return {
    port: Number(env.PORT || 4100),
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    redisUrl: env.REDIS_URL || DEFAULT_REDIS_URL,
    redisPrefix: env.REDIS_PREFIX || DEFAULT_REDIS_PREFIX,
    webOrigin: env.WEB_ORIGIN || "http://localhost:5180",
    // "1" means one proxy hop (Render, Fly); a number counts hops, anything else is a list of addresses.
    trustProxy: trust === undefined || trust === "" ? false : /^\d+$/.test(trust) ? Number(trust) : trust === "true" ? true : trust,
    publicRateLimit: Number(env.PUBLIC_RATE_LIMIT || 5),
    publicWindowSec: Number(env.PUBLIC_RATE_WINDOW_SEC || 3600),
    publicLive: env.PUBLIC_LIVE === "1",
    runWorker: argv.includes("--with-worker") || env.RUN_WORKER === "1",
    devApiKey: production ? null : (env.API_KEY_DEV || "dev-key"),
    fixturesDir: depsConfigFromEnv(env).fixturesDir,
    webhook: webhookFromEnv(env),
    backoffMs: Number(env.RETRY_BACKOFF_MS || 10_000),
  };
}

export type RunningServer = {
  url: string;
  port: number;
  worker: Worker | null;
  close: () => Promise<void>;
};

/**
 * Starts the API (and the worker when asked). `deps` replaces the audit dependencies, which
 * is how tests swap in replayed or failing model clients.
 */
export async function startServer(
  cfg: ServerConfig,
  opts: { deps?: (req: AuditRequest) => AuditDeps; log?: (message: string) => void } = {},
): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const { db, close: closeDb } = connect(cfg.databaseUrl);
  const redis = redisConnection(cfg.redisUrl);
  const queue = createAuditQueue({ connection: redis, prefix: cfg.redisPrefix, backoffMs: cfg.backoffMs });
  const stores = fsStores({ fixturesDir: cfg.fixturesDir, imageCacheDir: depsConfigFromEnv().imageCacheDir });

  if (cfg.devApiKey) await ensureApiKey(db, { name: "dev", hash: hashKey(cfg.devApiKey) });

  let worker: Worker | null = null;
  if (cfg.runWorker) {
    // The worker blocks on its own connection, so it doesn't share the API's.
    worker = startWorker({
      db,
      connection: redisConnection(cfg.redisUrl),
      prefix: cfg.redisPrefix,
      makeDeps: opts.deps ?? makeDeps(depsConfigFromEnv()),
      webhook: cfg.webhook,
      log,
    });
  }

  const app = createApp({ db, redis, queue, listings: stores.listings, config: cfg, log });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(cfg.port, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    worker,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (worker) await worker.close();
      await queue.close();
      await redis.quit();
      await closeDb();
    },
  };
}
