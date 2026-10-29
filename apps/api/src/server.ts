import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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
  type RunningWorker,
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
  /** Seeded as an API key on startup, only when API_KEY_DEV is set and not in production. */
  devApiKey: string | null;
  fixturesDir: string;
  webhook: WebhookConfig | null;
  /** Retry backoff for failed audits. */
  backoffMs: number;
};

/**
 * TRUST_PROXY is the number of proxy hops in front of the API (1 on Render or Fly). Express's
 * `true` would trust any X-Forwarded-For a client sends, letting anyone dodge the per-IP limit,
 * so "true" is read as 1 hop with a warning and anything else that isn't a count is refused.
 */
export function parseTrustProxy(value: string | undefined, warn: (message: string) => void): number | false {
  if (value === undefined || value === "" || value === "0" || value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true") {
    warn('TRUST_PROXY=true trusts any client-sent X-Forwarded-For; using 1 hop instead. Set TRUST_PROXY to the hop count.');
    return 1;
  }
  throw new Error(`TRUST_PROXY must be a hop count such as 1, got "${value}"`);
}

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv,
  warn: (message: string) => void = (m) => console.warn(m),
): ServerConfig {
  const production = env.NODE_ENV === "production";
  return {
    port: Number(env.PORT || 4100),
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    redisUrl: env.REDIS_URL || DEFAULT_REDIS_URL,
    redisPrefix: env.REDIS_PREFIX || DEFAULT_REDIS_PREFIX,
    webOrigin: env.WEB_ORIGIN || "http://localhost:5180",
    trustProxy: parseTrustProxy(env.TRUST_PROXY, warn),
    publicRateLimit: Number(env.PUBLIC_RATE_LIMIT || 5),
    publicWindowSec: Number(env.PUBLIC_RATE_WINDOW_SEC || 3600),
    publicEmailLimit: Number(env.PUBLIC_EMAIL_LIMIT || 10),
    publicLive: env.PUBLIC_LIVE === "1",
    demoReadonly: env.DEMO_READONLY === "1",
    runWorker: argv.includes("--with-worker") || env.RUN_WORKER === "1",
    // Never a built-in default: a deploy that forgets NODE_ENV mustn't accept a well-known key.
    devApiKey: !production && env.API_KEY_DEV ? env.API_KEY_DEV : null,
    fixturesDir: depsConfigFromEnv(env).fixturesDir,
    webhook: webhookFromEnv(env),
    backoffMs: Number(env.RETRY_BACKOFF_MS || 10_000),
  };
}

export type RunningServer = {
  url: string;
  port: number;
  worker: RunningWorker | null;
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
  // ioredis emits an error on every failed reconnect; log the first of a run, not hundreds.
  let redisDown = false;
  redis.on("error", (err) => {
    if (!redisDown) log(`redis error: ${err.message}`);
    redisDown = true;
  });
  redis.on("ready", () => (redisDown = false));
  const queue = createAuditQueue({ connection: redis, prefix: cfg.redisPrefix, backoffMs: cfg.backoffMs });
  queue.on("error", () => {});
  const stores = fsStores({ fixturesDir: cfg.fixturesDir, imageCacheDir: depsConfigFromEnv().imageCacheDir });

  if (cfg.devApiKey) await ensureApiKey(db, { name: "dev", hash: hashKey(cfg.devApiKey) });

  // The worker opens its own blocking connection, separate from the API's fail-fast one.
  const worker = cfg.runWorker
    ? startWorker({
        db,
        redisUrl: cfg.redisUrl,
        prefix: cfg.redisPrefix,
        makeDeps: opts.deps ?? makeDeps(depsConfigFromEnv()),
        webhook: cfg.webhook,
        log,
      })
    : null;

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
      await queue.close().catch(() => {});
      await redis.quit().catch(() => redis.disconnect());
      await closeDb();
    },
  };
}
