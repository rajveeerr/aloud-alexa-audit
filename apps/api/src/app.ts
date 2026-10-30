import cors from "cors";
import express, { type Request } from "express";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  Asin,
  CreateAuditBody,
  CreateBulkBody,
  ListingsQuery,
  PublicAuditBody,
  PublicEmailBody,
  RescoreBody,
  type AuditOrigin,
  type Health,
} from "@aloud/contracts";
import { addLead, addLeadOnce, getAudit, getBulk, history, leadAuditIds, listAudits, listBulks, type Db } from "@aloud/db";
import type { ListingStore } from "@aloud/pipeline";
import { rescore, startBulk, submitAudit, type AuditJobData } from "@aloud/worker";
import { requireApiKey } from "./auth";
import { errorHandler, HttpError, notFound } from "./errors";
import { publicSource, savedListings } from "./listings";
import { openApiDocument } from "./openapi";
import { hit, takeDaily } from "./ratelimit";
import { DAILY_LIMIT_MESSAGE, toAuditJob, toBriefs, toBulkJob, toBulkSummary, toHistory, toPublicResult, toSummary } from "./views";

export type AppConfig = {
  webOrigin: string;
  /** Proxy hops in front of the API, for Express's "trust proxy". False ignores X-Forwarded-For. */
  trustProxy: number | false;
  redisPrefix: string;
  /** Widget audits per IP per window. */
  publicRateLimit: number;
  publicWindowSec: number;
  /** Emails left on widget audits per IP per window. Separate from audits, so a visitor who used them up can still leave one. */
  publicEmailLimit: number;
  /**
   * Let widget audits fetch unsaved listings through SerpApi, with no competitors, so each costs
   * one search. Off by default.
   */
  publicLive: boolean;
  /** Live widget audits per UTC day across all visitors. Saved products don't count. */
  publicLiveDailyLimit: number;
  /**
   * For a public demo whose app bundle carries its key: keyed audits may only use saved listings
   * (live is forced off, no pasted listings), bulk jobs take at most DEMO_BULK_MAX ASINs and
   * rescore is refused. Off by default.
   */
  demoReadonly: boolean;
};

export const DEMO_BULK_MAX = 10;

function demoRefused(message: string): HttpError {
  return new HttpError(403, "demo_readonly", `${message} This deploy is a read-only demo.`);
}

export type AppContext = {
  db: Db;
  redis: Redis;
  queue: Queue<AuditJobData>;
  listings: ListingStore;
  config: AppConfig;
  log: (message: string) => void;
};

const ListAuditsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const ListBulkQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const IdParam = z.object({ id: z.uuid() });
const AsinParam = z.object({ asin: Asin });

/** A promise that rejects after `ms`, so a hung dependency can't hang the health check too. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timed out")), ms)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** The web app says it's the web app; everything else with a key is an API integration. */
function originOf(req: Request): AuditOrigin {
  return req.get("x-aloud-origin") === "app" ? "app" : "api";
}

export function createApp(ctx: AppContext): express.Express {
  const { db, redis, queue, config } = ctx;
  const jobs = { db, queue, log: ctx.log };
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  // Retry-After is exposed so the web app can back off on a 429 instead of guessing.
  app.use(cors({ origin: config.webOrigin, exposedHeaders: ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining"] }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/v1/health", async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([
      within(db.execute("select 1"), 2000).then(() => true, () => false),
      within(redis.ping(), 2000).then(() => true, () => false),
    ]);
    const body: Health = { ok: dbOk && redisOk, db: dbOk, redis: redisOk };
    res.status(body.ok ? 200 : 503).json(body);
  });

  app.get("/v1/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.get("/v1/listings", async (req, res) => {
    const q = ListingsQuery.parse(req.query);
    res.json(await savedListings(ctx.listings, q.source ? [q.source] : ["serpapi", "dataset"]));
  });

  /** The homepage widget has no key, so its writes are limited per IP instead, each kind in its own bucket. */
  async function limitPublic(req: Request, res: express.Response, bucket: "audits" | "email") {
    const [name, limit] = bucket === "audits" ? ["public", config.publicRateLimit] : ["public-email", config.publicEmailLimit];
    const h = await hit(redis, `${config.redisPrefix}:rl:${name}:${req.ip}`, limit, config.publicWindowSec);
    if (!h.allowed) {
      res.set("Retry-After", String(h.retryAfterSec));
      const what = bucket === "audits" ? "free audits" : "emails";
      throw new HttpError(429, "rate_limited", `Only ${limit} ${what} an hour; try again later`);
    }
  }

  app.post("/v1/public/audits", async (req, res) => {
    await limitPublic(req, res, "audits");
    const body = PublicAuditBody.parse(req.body);
    const { source, saved } = await publicSource(ctx.listings, body.asin);
    // Saved products replay for free. Any other ASIN is fetched live, without competitors, so it
    // costs one SerpApi search, and those are capped per day for everyone together.
    const live = config.publicLive && !saved;
    const slot = live ? await takeDaily(redis, `${config.redisPrefix}:daily:public-live`, config.publicLiveDailyLimit) : null;
    if (slot && !slot.allowed) {
      res.set("Retry-After", String(slot.retryAfterSec));
      throw new HttpError(429, "daily_limit", DAILY_LIMIT_MESSAGE);
    }
    const request = live ? { live: true, maxCompetitors: 0 } : { live: false };
    // The slot is only spent on an audit that actually reached the queue.
    const row = await submitAudit(jobs, { asin: body.asin, source, origin: "widget", request }).catch(async (err) => {
      await slot?.release().catch((e) => ctx.log(`couldn't give back a live widget slot: ${(e as Error).message}`));
      throw err;
    });
    // The audit is already queued, so a lead that fails to save mustn't turn this into a 500.
    let captured = false;
    if (body.email) {
      captured = await addLead(db, { email: body.email, asin: body.asin, auditId: row.id }).then(
        () => true,
        (err) => {
          ctx.log(`couldn't save lead for audit ${row.id}: ${(err as Error).stack ?? String(err)}`);
          return false;
        },
      );
    }
    res.status(202).json(toPublicResult(row, captured));
  });

  app.get("/v1/public/audits/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const row = await getAudit(db, id);
    // Only widget audits are visible here, so an id from the app can't be read without a key.
    if (!row || row.origin !== "widget") throw new HttpError(404, "not_found", "No such audit");
    const captured = (await leadAuditIds(db, [row.id])).has(row.id);
    res.json(toPublicResult(row, captured));
  });

  // An email left after the widget showed its teaser: unlocks the full report for that audit.
  app.post("/v1/public/audits/:id/email", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { email } = PublicEmailBody.parse(req.body);
    const row = await getAudit(db, id);
    if (!row || row.origin !== "widget") throw new HttpError(404, "not_found", "No such audit");
    // Charged only once the request is valid, so typos and bad ids don't use up the visitor's emails.
    await limitPublic(req, res, "email");
    await addLeadOnce(db, { email, asin: row.asin, auditId: row.id });
    res.status(202).json(toPublicResult(row, true));
  });

  const v1 = express.Router();
  v1.use(requireApiKey(db, redis, config.redisPrefix));

  v1.post("/audits", async (req, res) => {
    const body = CreateAuditBody.parse(req.body);
    if (config.demoReadonly && body.source === "paste") throw demoRefused("Pasted listings are turned off; pick a saved listing.");
    const row = await submitAudit(jobs, {
      asin: body.asin,
      source: body.source,
      origin: originOf(req),
      request: {
        live: config.demoReadonly ? false : body.live,
        ...(body.paste && { paste: body.paste }),
        ...(body.category && { category: body.category }),
        ...(body.competitors && { competitors: body.competitors }),
      },
    });
    res.status(202).json({ id: row.id, status: row.status });
  });

  v1.get("/audits", async (req, res) => {
    const { limit } = ListAuditsQuery.parse(req.query);
    res.json((await listAudits(db, limit)).map(toSummary));
  });

  v1.get("/audits/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const row = await getAudit(db, id);
    if (!row) throw new HttpError(404, "not_found", "No such audit");
    res.json(toAuditJob(row));
  });

  v1.post("/audits/:id/briefs", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const row = await getAudit(db, id);
    if (!row) throw new HttpError(404, "not_found", "No such audit");
    if (row.status !== "done") throw new HttpError(409, "not_done", `The audit is ${row.status}; briefs are ready once it's done`);
    res.json(toBriefs(row));
  });

  v1.get("/asins/:asin/history", async (req, res) => {
    const { asin } = AsinParam.parse(req.params);
    res.json(toHistory(asin, await history(db, asin)));
  });

  v1.post("/rescore", async (req, res) => {
    const body = RescoreBody.parse(req.body);
    if (config.demoReadonly) throw demoRefused("Rescore is turned off.");
    const result = await rescore({ ...jobs, listings: ctx.listings }, body);
    res.status(result.skipped ? 200 : 202).json(result);
  });

  v1.post("/bulk", async (req, res) => {
    const body = CreateBulkBody.parse(req.body);
    if (config.demoReadonly && new Set(body.asins).size > DEMO_BULK_MAX) throw demoRefused(`Bulk jobs are limited to ${DEMO_BULK_MAX} ASINs.`);
    res.status(202).json(await startBulk(jobs, config.demoReadonly ? { ...body, live: false } : body));
  });

  v1.get("/bulk", async (req, res) => {
    const { limit } = ListBulkQuery.parse(req.query);
    res.json((await listBulks(db, limit)).map((b) => toBulkSummary(b.job, b.done, b.failed)));
  });

  v1.get("/bulk/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const found = await getBulk(db, id);
    if (!found) throw new HttpError(404, "not_found", "No such bulk job");
    res.json(toBulkJob(found.job, found.audits));
  });

  app.use("/v1", v1);
  app.use(notFound);
  app.use(errorHandler(ctx.log));
  return app;
}
