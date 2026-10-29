/**
 * Integration tests: the API and worker in-process against the compose MySQL and Redis
 * (`bun run db:up`). Model calls replay from fixtures/llm and listings come from fixtures/,
 * so nothing here calls Gemini or SerpApi. Each run gets its own database and Redis prefix.
 * Set SKIP_INTEGRATION=1 to skip them when compose isn't running.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type { AsinHistory, AuditJob, AuditSummary, BulkJob, PublicAuditResult, RescoreResult, SavedListing, StudioBriefs } from "@answerable/contracts";
import type { JsonModel } from "@answerable/core";
import { audits, connect, createAudit, dropDatabase, ensureDatabase, getAudit, leadsFor, markFailed, markRunning, runMigrations, type DbHandle } from "@answerable/db";
import { ProviderError, QuotaExhaustedError } from "@answerable/providers";
import {
  createAuditQueue,
  depsConfigFromEnv,
  EnqueueError,
  enqueueAudits,
  INTERNAL_MESSAGE,
  makeDeps,
  onJobFailed,
  redisConnection,
  SIGNATURE_HEADER,
  startBulk,
  startWorker,
  submitAudit,
  verify,
  type AuditJobData,
  type WebhookConfig,
} from "@answerable/worker";
import { configFromEnv, startServer, type RunningServer, type ServerConfig } from "./server";

const DB_URL = process.env.TEST_DATABASE_URL || "mysql://root:answerable@127.0.0.1:3317/answerable_test";
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6389";
// The suite drops this database, so never let it point at a real one.
if (!new URL(DB_URL).pathname.endsWith("_test")) throw new Error(`TEST_DATABASE_URL must name a *_test database, got ${DB_URL}`);
const PREFIX = `test-${randomUUID().slice(0, 8)}`;
const KEY = "test-key";
const PUBLIC_LIMIT = 3;

/** Replay only: no Gemini key, so any unrecorded call fails instead of spending quota. */
const replayDeps = makeDeps(depsConfigFromEnv({}));

let server: RunningServer;
let handle: DbHandle;

function serverConfig(prefix: string): ServerConfig {
  return {
    ...configFromEnv({}, []),
    port: 0,
    databaseUrl: DB_URL,
    redisUrl: REDIS_URL,
    redisPrefix: prefix,
    runWorker: true,
    devApiKey: KEY,
    trustProxy: 1,
    publicRateLimit: PUBLIC_LIMIT,
    webhook: null,
    backoffMs: 50,
  };
}

async function callAt<T = any>(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-api-key": KEY }) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as T };
}

const call = <T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => callAt<T>(server.url, method, path, body, headers);

/** A worker on its own queue prefix whose model is swapped out, for failure paths. */
function sideWorker(name: string, model: () => JsonModel, webhook: WebhookConfig | null = null) {
  const prefix = `${PREFIX}-${name}`;
  const connection = redisConnection(REDIS_URL);
  const queue = createAuditQueue({ connection, prefix, backoffMs: 10 });
  const worker = startWorker({ db: handle.db, redisUrl: REDIS_URL, prefix, makeDeps: (req) => ({ ...replayDeps(req), llm: model() }), webhook, log: () => {} });
  return {
    queue,
    async close() {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    },
  };
}

async function until<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (done(v) || Date.now() > end) return v;
    await Bun.sleep(100);
  }
}

const finished = (s: string) => s === "done" || s === "failed";
const pollAudit = (id: string) => until(async () => (await call<AuditJob>("GET", `/v1/audits/${id}`)).body, (a) => finished(a.status));

async function createAndWait(body: unknown): Promise<AuditJob> {
  const res = await call<{ id: string; status: string }>("POST", "/v1/audits", body);
  expect(res.status).toBe(202);
  expect(res.body.status).toBe("queued");
  return pollAudit(res.body.id);
}

describe.skipIf(process.env.SKIP_INTEGRATION === "1")("api + worker (compose, replayed)", () => {
  let hero: AuditJob;

  beforeAll(async () => {
    await dropDatabase(DB_URL);
    await ensureDatabase(DB_URL);
    handle = connect(DB_URL);
    await runMigrations(handle.db);
    server = await startServer(serverConfig(PREFIX), { deps: replayDeps, log: () => {} });
  });

  afterAll(async () => {
    await server?.close();
    await handle?.close();
    await dropDatabase(DB_URL);
    const redis = redisConnection(REDIS_URL);
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  test("health reports both dependencies", async () => {
    const res = await call("GET", "/v1/health", undefined, {});
    expect(res).toMatchObject({ status: 200, body: { ok: true, db: true, redis: true } });
  });

  test("the hero audit (serpapi) finishes with score 52 and 2 hidden answers", async () => {
    hero = await createAndWait({ asin: "B0C9W8DD9S", source: "serpapi" });
    expect(hero.status).toBe("done");
    expect(hero.score).toBe(52);
    expect(hero.report!.score.score).toBe(52);
    expect(hero.report!.hiddenAnswers).toHaveLength(2);
    expect(hero.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hero.origin).toBe("api");
  }, 30_000);

  test("a dataset audit scores 84", async () => {
    const a = await createAndWait({ asin: "B09VD1Z3TK", source: "dataset" });
    expect(a.status).toBe("done");
    expect(a.report!.score.score).toBe(84);
  }, 30_000);

  test("an unknown ASIN without live fails with listing_not_found", async () => {
    const a = await createAndWait({ asin: "B000000000", source: "serpapi" });
    expect(a.status).toBe("failed");
    expect(a.error?.code).toBe("listing_not_found");
    expect(a.report).toBeUndefined();
  }, 30_000);

  test("validation errors are 400 with the ApiError shape", async () => {
    const res = await call("POST", "/v1/audits", { asin: "nope", source: "elsewhere" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["asin", "source"]);

    const bad = await call("POST", "/v1/audits", "{not json");
    expect(bad).toMatchObject({ status: 400, body: { error: { code: "invalid_json" } } });
  });

  test("a missing or wrong API key is 401", async () => {
    expect(await call("GET", "/v1/audits", undefined, {})).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
    expect((await call("GET", "/v1/audits", undefined, { "x-api-key": "wrong" })).status).toBe(401);
  });

  test("an unknown audit is 404", async () => {
    expect(await call("GET", `/v1/audits/${randomUUID()}`)).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
  });

  test("lists audits newest first with brand, title and category", async () => {
    const res = await call<AuditSummary[]>("GET", "/v1/audits?limit=50");
    expect(res.status).toBe(200);
    const times = res.body.map((a) => a.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    const h = res.body.find((a) => a.id === hero.id)!;
    expect(h).toMatchObject({ brand: "Ddaowanx", category: "Gel Ink Rollerball Pens", score: 52 });
    expect(h).not.toHaveProperty("report");
    expect((await call("GET", "/v1/audits?limit=0")).status).toBe(400);
  });

  test("briefs are 409 before the audit is done, then the fix list", async () => {
    // Created without a job, so it stays queued.
    const queued = await createAudit(handle.db, { asin: "B0C9W8DD9S", source: "serpapi", origin: "api", request: { live: false } });
    expect(await call("POST", `/v1/audits/${queued.id}/briefs`)).toMatchObject({ status: 409, body: { error: { code: "not_done" } } });
    // Clean up, or the rescore test would see it as an audit already pending.
    await markFailed(handle.db, queued.id, { code: "internal", message: "test cleanup" });

    const res = await call<StudioBriefs>("POST", `/v1/audits/${hero.id}/briefs`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ auditId: hero.id, asin: "B0C9W8DD9S", category: "Gel Ink Rollerball Pens" });
    expect(res.body.briefs[0]).toMatchObject({ intentId: "ink_flow", action: "move_from_image" });
  });

  test("history has a point per done audit", async () => {
    const res = await call<AsinHistory>("GET", "/v1/asins/B0C9W8DD9S/history");
    expect(res.status).toBe(200);
    expect(res.body.points.length).toBeGreaterThanOrEqual(1);
    expect(res.body.points[0]).toMatchObject({ auditId: hero.id, score: 52, contentHash: hero.contentHash, origin: "api" });
  });

  test("rescore skips an unchanged listing and queues a never-audited one", async () => {
    const same = await call<RescoreResult>("POST", "/v1/rescore", { asin: "B0C9W8DD9S", source: "serpapi", reason: "listing updated" });
    expect(same).toMatchObject({ status: 200, body: { skipped: true, reason: "unchanged", auditId: hero.id } });

    const fresh = await call<RescoreResult>("POST", "/v1/rescore", { asin: "B001GAOTSW", source: "serpapi", reason: "first look" });
    expect(fresh.status).toBe(202);
    expect(fresh.body.skipped).toBe(false);
    const a = await pollAudit(fresh.body.auditId);
    expect(a).toMatchObject({ status: "done", origin: "rescore" });

    expect((await call("POST", "/v1/rescore", { asin: "B000000000", reason: "x" })).status).toBe(404);
  }, 30_000);

  test("a bulk job of 3 dataset ASINs reaches done = 3", async () => {
    const res = await call<{ id: string }>("POST", "/v1/bulk", { name: "dataset trio", asins: ["B09YP9YYZG", "B0143LMAEK", "B09VD1Z3TK"], source: "dataset" });
    expect(res.status).toBe(202);
    const job = await until(async () => (await call<BulkJob>("GET", `/v1/bulk/${res.body.id}`)).body, (b) => b.status === "done", 30_000);
    expect(job).toMatchObject({ name: "dataset trio", status: "done", total: 3, done: 3, failed: 0 });
    expect(job.audits.map((a) => a.asin).sort()).toEqual(["B0143LMAEK", "B09VD1Z3TK", "B09YP9YYZG"]);

    // The list has it first, in the same shape as GET /v1/bulk/:id.
    const list = await call<BulkJob[]>("GET", "/v1/bulk?limit=5");
    expect(list.status).toBe(200);
    expect(list.body[0]).toEqual(job);
    expect((await call("GET", "/v1/bulk?limit=0")).status).toBe(400);
  }, 40_000);

  test("the public audit shows only the top 3 gaps and stores the email", async () => {
    const ip = { "x-forwarded-for": "10.0.0.1" };
    const res = await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B0C9W8DD9S", email: "brand@example.com" }, ip);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "queued", asin: "B0C9W8DD9S", emailCaptured: true });

    const done = await until(async () => (await call<PublicAuditResult>("GET", `/v1/public/audits/${res.body.id}`, undefined, {})).body, (r) => finished(r.status));
    expect(done).toMatchObject({ status: "done", score: 52, scoreBasis: "mined", emailCaptured: true });
    expect(done.topGaps).toHaveLength(3);
    // Ink flow: all four competitors answer it (Pilot only partly), shown as counts.
    expect(done.topGaps![0]).toMatchObject({ hiddenInImage: true, competitorsAnswering: 4, competitors: 4 });
    expect(done).not.toHaveProperty("report");
    // It's the three highest-priority gaps from the full report, in order.
    const full = (await getAudit(handle.db, res.body.id))!.report as NonNullable<AuditJob["report"]>;
    const questions = new Map(full.intentSet.intents.map((i) => [i.id, i.question]));
    const expected = [...full.gaps].sort((a, b) => b.priority - a.priority).slice(0, 3).map((g) => questions.get(g.intentId) ?? g.intentId);
    expect(done.topGaps!.map((g) => g.question)).toEqual(expected);

    const leads = await leadsFor(handle.db, res.body.id);
    expect(leads.map((l) => l.email)).toEqual(["brand@example.com"]);

    // An app audit isn't readable through the public endpoint.
    expect((await call("GET", `/v1/public/audits/${hero.id}`, undefined, {})).status).toBe(404);
  }, 30_000);

  test("an email can be added to a widget audit after it started", async () => {
    const ip = { "x-forwarded-for": "10.0.1.1" };
    const res = await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, ip);
    expect(res.body.emailCaptured).toBe(false);

    const added = await call<PublicAuditResult>("POST", `/v1/public/audits/${res.body.id}/email`, { email: "later@example.com" }, ip);
    expect(added.status).toBe(202);
    expect(added.body).toMatchObject({ id: res.body.id, emailCaptured: true });
    expect((await leadsFor(handle.db, res.body.id)).map((l) => l.email)).toEqual(["later@example.com"]);
    expect((await call<PublicAuditResult>("GET", `/v1/public/audits/${res.body.id}`, undefined, {})).body.emailCaptured).toBe(true);

    expect((await call("POST", `/v1/public/audits/${res.body.id}/email`, { email: "nope" }, ip)).status).toBe(400);
    // Only widget audits take a lead this way.
    expect((await call("POST", `/v1/public/audits/${hero.id}/email`, { email: "x@example.com" }, { "x-forwarded-for": "10.0.1.2" })).status).toBe(404);
  });

  test("adding an email shares the widget's per-IP limit", async () => {
    const ip = { "x-forwarded-for": "10.0.1.3" };
    const res = await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, ip);
    for (let i = 1; i < PUBLIC_LIMIT; i++) {
      expect((await call("POST", `/v1/public/audits/${res.body.id}/email`, { email: `n${i}@example.com` }, ip)).status).toBe(202);
    }
    const limited = await call("POST", `/v1/public/audits/${res.body.id}/email`, { email: "over@example.com" }, ip);
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
  });

  test("the public endpoint is rate limited per IP", async () => {
    const ip = { "x-forwarded-for": "10.0.0.2" };
    for (let i = 0; i < PUBLIC_LIMIT; i++) {
      expect((await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, ip)).body.emailCaptured).toBe(false);
    }
    const limited = await call("POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, ip);
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another IP still gets in.
    expect((await call("POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, { "x-forwarded-for": "10.0.0.3" })).status).toBe(202);
  });

  test("saved listings are offered as demo products", async () => {
    const res = await call<SavedListing[]>("GET", "/v1/listings?source=serpapi", undefined, {});
    expect(res.status).toBe(200);
    expect(res.body.every((l) => l.source === "serpapi")).toBe(true);
    expect(res.body.find((l) => l.asin === "B0C9W8DD9S")).toMatchObject({ brand: "Ddaowanx", category: "Gel Ink Rollerball Pens" });
    expect((await call("GET", "/v1/listings?source=nope", undefined, {})).status).toBe(400);
  });

  test("the OpenAPI document covers every route", async () => {
    const res = await call("GET", "/v1/openapi.json", undefined, {});
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths).sort()).toEqual(
      [
        "/v1/health",
        "/v1/openapi.json",
        "/v1/listings",
        "/v1/audits",
        "/v1/audits/{id}",
        "/v1/audits/{id}/briefs",
        "/v1/asins/{asin}/history",
        "/v1/rescore",
        "/v1/bulk",
        "/v1/bulk/{id}",
        "/v1/public/audits",
        "/v1/public/audits/{id}",
        "/v1/public/audits/{id}/email",
      ].sort(),
    );
  });

  test("a used-up model quota delays the job and leaves the audit queued", async () => {
    const quota = {
      generateJson: async () => {
        throw new QuotaExhaustedError("Gemini daily quota exhausted: GenerateRequestsPerDayPerProjectPerModel-FreeTier", "GenerateRequestsPerDayPerProjectPerModel-FreeTier");
      },
    };
    const side = sideWorker("quota", () => quota);
    const { queue } = side;
    try {
      const row = await createAudit(handle.db, { asin: "B0C9W8DD9S", source: "serpapi", origin: "api", request: { live: false } });
      await enqueueAudits(queue, [row.id]);

      const state = await until(() => queue.getJobState(row.id), (s) => s === "delayed");
      expect(state).toBe("delayed");
      const job = (await queue.getJob(row.id))!;
      expect(job.attemptsMade).toBe(0);
      // Delayed until the next midnight Pacific, which is under a day away.
      const wakeAt = job.timestamp + job.delay;
      expect(wakeAt - Date.now()).toBeGreaterThan(0);
      expect(wakeAt - Date.now()).toBeLessThanOrEqual(25 * 3600_000);

      const after = (await getAudit(handle.db, row.id))!;
      expect(after.status).toBe("queued");
      expect(after.note).toContain("quota");
      expect((await call<AuditJob>("GET", `/v1/audits/${row.id}`)).body).toMatchObject({ status: "queued", note: expect.stringContaining("quota") });
    } finally {
      await side.close();
    }
  }, 30_000);

  test("retryable model errors retry 3 times, then fail; the bulk job still finishes", async () => {
    const events: { body: string; signature: string | null }[] = [];
    const receiver = Bun.serve({
      port: 0,
      fetch: async (req) => {
        events.push({ body: await req.text(), signature: req.headers.get(SIGNATURE_HEADER) });
        return new Response("ok");
      },
    });
    let calls = 0;
    const flaky = {
      generateJson: async () => {
        calls++;
        throw new ProviderError("Gemini: 503 overloaded", "gemini", 503, true);
      },
    };
    const side = sideWorker("retry", () => flaky, { url: `http://127.0.0.1:${receiver.port}/hook`, secret: "hook-secret" });
    try {
      const { id } = await startBulk({ db: handle.db, queue: side.queue }, { name: "flaky", asins: ["B09YP9YYZG", "B0143LMAEK"], source: "dataset", live: false });
      const bulk = await until(async () => (await call<BulkJob>("GET", `/v1/bulk/${id}`)).body, (b) => b.status === "done", 30_000);
      expect(bulk).toMatchObject({ status: "done", total: 2, done: 0, failed: 2 });

      for (const a of bulk.audits) {
        const row = (await getAudit(handle.db, a.id))!;
        expect(row.error).toMatchObject({ code: "provider_unavailable" });
        expect((await side.queue.getJob(a.id))!.attemptsMade).toBe(3);
      }
      expect(calls).toBe(6);

      const failed = await until(async () => events, (e) => e.length >= 2, 5_000);
      for (const e of failed) {
        expect(verify(e.body, "hook-secret", e.signature ?? "")).toBe(true);
        expect(JSON.parse(e.body)).toMatchObject({ type: "audit.failed", error: { code: "provider_unavailable" } });
      }
    } finally {
      await side.close();
      receiver.stop(true);
    }
  }, 40_000);

  test("an unexpected error ends as internal with a generic message", async () => {
    const side = sideWorker("internal", () => ({
      generateJson: async () => {
        throw new TypeError("cannot read 'secret' of undefined");
      },
    }));
    try {
      const row = await createAudit(handle.db, { asin: "B09VD1Z3TK", source: "dataset", origin: "api", request: { live: false } });
      await enqueueAudits(side.queue, [row.id]);
      const done = await until(async () => (await call<AuditJob>("GET", `/v1/audits/${row.id}`)).body, (a) => finished(a.status));
      expect(done).toMatchObject({ status: "failed", error: { code: "internal", message: INTERNAL_MESSAGE } });
      expect(JSON.stringify(done)).not.toContain("secret");
    } finally {
      await side.close();
    }
  }, 30_000);

  test("an audit needing unrecorded model calls fails at once as not_recorded", async () => {
    const a = await createAndWait({
      asin: "B0PASTE001",
      source: "paste",
      category: "Gel Ink Rollerball Pens",
      paste: { title: `A pen nobody recorded ${randomUUID()}`, bullets: ["Writes in blue"] },
    });
    expect(a).toMatchObject({ status: "failed", error: { code: "not_recorded" } });
  }, 30_000);

  test("a job that stalled out is marked failed by the failed listener", async () => {
    const row = await createAudit(handle.db, { asin: "B09VD1Z3TK", source: "dataset", origin: "api", request: { live: false } });
    await markRunning(handle.db, row.id);
    const job = { id: row.id, data: { auditId: row.id }, attemptsMade: 1, opts: { attempts: 3 } } as unknown as Job<AuditJobData>;
    await onJobFailed(job, new Error("job stalled more than allowable limit"), { db: handle.db, makeDeps: replayDeps });
    expect((await getAudit(handle.db, row.id))!).toMatchObject({ status: "failed", error: { code: "stalled" } });

    // A retry that still has attempts left is left alone.
    const other = await createAudit(handle.db, { asin: "B09VD1Z3TK", source: "dataset", origin: "api", request: { live: false } });
    await onJobFailed({ ...job, data: { auditId: other.id } } as Job<AuditJobData>, new Error("503"), { db: handle.db, makeDeps: replayDeps });
    expect((await getAudit(handle.db, other.id))!.status).toBe("queued");
  });

  test("audits that can't be queued are marked enqueue_failed, so a bulk job still finishes", async () => {
    const broken = { addBulk: async () => Promise.reject(new Error("Connection is closed.")) } as unknown as Queue<AuditJobData>;
    const err = await submitAudit({ db: handle.db, queue: broken }, { asin: "B09VD1Z3TK", source: "dataset", origin: "api", request: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(EnqueueError);
    expect((await getAudit(handle.db, err.auditIds[0]))!).toMatchObject({ status: "failed", error: { code: "enqueue_failed" } });

    const bulkErr = await startBulk({ db: handle.db, queue: broken }, { name: "no queue", asins: ["B09YP9YYZG", "B0143LMAEK"], source: "dataset", live: false }).catch((e) => e);
    expect(bulkErr).toBeInstanceOf(EnqueueError);
    const ids = await handle.db.select({ bulkJobId: audits.bulkJobId }).from(audits).where(eq(audits.id, bulkErr.auditIds[0]));
    const bulk = await call<BulkJob>("GET", `/v1/bulk/${ids[0]!.bulkJobId}`);
    expect(bulk.body).toMatchObject({ status: "done", total: 2, done: 0, failed: 2 });
  });

  test("two rescore webhooks in a row queue one audit", async () => {
    const body = { asin: "B0BGPYR8Q3", source: "serpapi", reason: "listing updated" };
    const [a, b] = [await call<RescoreResult>("POST", "/v1/rescore", body), await call<RescoreResult>("POST", "/v1/rescore", body)];
    expect(a.body.skipped).toBe(false);
    // The second sees the first still pending (skipped false) or already done and unchanged (skipped true).
    expect(b.body.auditId).toBe(a.body.auditId);
  });

  test("a widget lead that can't be saved still queues the audit", async () => {
    const tooLong = `brand@${"x".repeat(60)}.${"y".repeat(60)}.${"z".repeat(60)}.${"w".repeat(60)}.${"v".repeat(60)}.${"u".repeat(60)}.com`;
    const res = await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B09VD1Z3TK", email: tooLong }, { "x-forwarded-for": "10.0.0.5" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "queued", emailCaptured: false });
    expect(await leadsFor(handle.db, res.body.id)).toEqual([]);
  });

  test("a failed widget audit says why, in safe words", async () => {
    const res = await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B000000000" }, { "x-forwarded-for": "10.0.0.6" });
    const done = await until(async () => (await call<PublicAuditResult>("GET", `/v1/public/audits/${res.body.id}`, undefined, {})).body, (r) => finished(r.status));
    expect(done).toMatchObject({ status: "failed", reason: expect.stringContaining("can't audit this product") });
  }, 30_000);

  test("without trust proxy, X-Forwarded-For can't dodge the per-IP limit", async () => {
    const strict = await startServer({ ...serverConfig(`${PREFIX}-strict`), runWorker: false, trustProxy: false, publicRateLimit: 1 }, { log: () => {} });
    try {
      const first = await callAt(strict.url, "POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, { "x-forwarded-for": "10.1.0.1" });
      const second = await callAt(strict.url, "POST", "/v1/public/audits", { asin: "B09VD1Z3TK" }, { "x-forwarded-for": "10.1.0.2" });
      expect(first.status).toBe(202);
      expect(second).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    } finally {
      await strict.close();
    }
  });

  test("with Redis down, requests answer 503 quickly instead of hanging", async () => {
    const down = await startServer({ ...serverConfig(`${PREFIX}-down`), runWorker: false, redisUrl: "redis://127.0.0.1:6399" }, { log: () => {} });
    try {
      const started = Date.now();
      expect(await callAt(down.url, "GET", "/v1/health", undefined, {})).toMatchObject({ status: 503, body: { ok: false, db: true, redis: false } });
      expect(await callAt(down.url, "POST", "/v1/audits", { asin: "B0C9W8DD9S" })).toMatchObject({ status: 503, body: { error: { code: "dependency_unavailable" } } });
      expect(await callAt(down.url, "POST", "/v1/public/audits", { asin: "B0C9W8DD9S" }, {})).toMatchObject({ status: 503, body: { error: { code: "dependency_unavailable" } } });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await down.close();
    }
  }, 20_000);
});
