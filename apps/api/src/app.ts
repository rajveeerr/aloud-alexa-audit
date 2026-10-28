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
  RescoreBody,
  type AuditOrigin,
  type Health,
} from "@answerable/contracts";
import { addLead, getAudit, getBulk, history, leadAuditIds, listAudits, type Db } from "@answerable/db";
import type { ListingStore } from "@answerable/pipeline";
import { rescore, startBulk, submitAudit, type AuditJobData } from "@answerable/worker";
import { requireApiKey } from "./auth";
import { errorHandler, HttpError, notFound } from "./errors";
import { publicSource, savedListings } from "./listings";
import { openApiDocument } from "./openapi";
import { hit } from "./ratelimit";
import { toAuditJob, toBriefs, toBulkJob, toHistory, toPublicResult, toSummary } from "./views";

export type AppConfig = {
  webOrigin: string;
  /** Proxy hops in front of the API, for Express's "trust proxy". False ignores X-Forwarded-For. */
  trustProxy: number | false;
  redisPrefix: string;
  /** Widget audits per IP per window. */
  publicRateLimit: number;
  publicWindowSec: number;
  /** Let widget audits fetch unsaved listings through SerpApi. Costs searches, so off by default. */
  publicLive: boolean;
};

export type AppContext = {
  db: Db;
  redis: Redis;
  queue: Queue<AuditJobData>;
  listings: ListingStore;
  config: AppConfig;
  log: (message: string) => void;
};

const ListAuditsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
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
  return req.get("x-answerable-origin") === "app" ? "app" : "api";
}

export function createApp(ctx: AppContext): express.Express {
  const { db, redis, queue, config } = ctx;
  const jobs = { db, queue, log: ctx.log };
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(cors({ origin: config.webOrigin }));
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

  // The homepage widget: no key, so it's limited per IP instead.
  app.post("/v1/public/audits", async (req, res) => {
    const h = await hit(redis, `${config.redisPrefix}:rl:public:${req.ip}`, config.publicRateLimit, config.publicWindowSec);
    if (!h.allowed) {
      res.set("Retry-After", String(h.retryAfterSec));
      throw new HttpError(429, "rate_limited", `Only ${config.publicRateLimit} free audits an hour; try again later`);
    }
    const body = PublicAuditBody.parse(req.body);
    const source = await publicSource(ctx.listings, body.asin);
    const row = await submitAudit(jobs, { asin: body.asin, source, origin: "widget", request: { live: config.publicLive } });
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

  const v1 = express.Router();
  v1.use(requireApiKey(db, redis, config.redisPrefix));

  v1.post("/audits", async (req, res) => {
    const body = CreateAuditBody.parse(req.body);
    const row = await submitAudit(jobs, {
      asin: body.asin,
      source: body.source,
      origin: originOf(req),
      request: {
        live: body.live,
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
    const result = await rescore({ ...jobs, listings: ctx.listings }, body);
    res.status(result.skipped ? 200 : 202).json(result);
  });

  v1.post("/bulk", async (req, res) => {
    const body = CreateBulkBody.parse(req.body);
    res.status(202).json(await startBulk(jobs, body));
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
