/**
 * Integration tests: the API and worker in-process against the compose MySQL and Redis
 * (`bun run db:up`). Model calls replay from fixtures/llm and listings come from fixtures/,
 * so nothing here calls Gemini or SerpApi. Each run gets its own database and Redis prefix.
 * Set SKIP_INTEGRATION=1 to skip them when compose isn't running.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Worker } from "bullmq";
import type { AsinHistory, AuditJob, AuditSummary, BulkJob, PublicAuditResult, RescoreResult, SavedListing, StudioBriefs } from "@answerable/contracts";
import { connect, createAudit, dropDatabase, ensureDatabase, getAudit, leadsFor, runMigrations, type DbHandle } from "@answerable/db";
import { QuotaExhaustedError } from "@answerable/providers";
import { createAuditQueue, depsConfigFromEnv, enqueueAudits, makeDeps, redisConnection, startWorker } from "@answerable/worker";
import { configFromEnv, startServer, type RunningServer } from "./server";

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

async function call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-api-key": KEY }) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as T };
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
    server = await startServer(
      {
        ...configFromEnv({}, []),
        port: 0,
        databaseUrl: DB_URL,
        redisUrl: REDIS_URL,
        redisPrefix: PREFIX,
        runWorker: true,
        devApiKey: KEY,
        trustProxy: true,
        publicRateLimit: PUBLIC_LIMIT,
        webhook: null,
        backoffMs: 50,
      },
      { deps: replayDeps, log: () => {} },
    );
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
  }, 40_000);

  test("the public audit shows only the top 3 gaps and stores the email", async () => {
    const ip = { "x-forwarded-for": "10.0.0.1" };
    const res = await call<PublicAuditResult>("POST", "/v1/public/audits", { asin: "B0C9W8DD9S", email: "brand@example.com" }, ip);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "queued", asin: "B0C9W8DD9S", emailCaptured: true });

    const done = await until(async () => (await call<PublicAuditResult>("GET", `/v1/public/audits/${res.body.id}`, undefined, {})).body, (r) => finished(r.status));
    expect(done).toMatchObject({ status: "done", score: 52, scoreBasis: "mined", emailCaptured: true });
    expect(done.topGaps).toHaveLength(3);
    expect(done.topGaps![0]).toMatchObject({ hiddenInImage: true });
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
      ].sort(),
    );
  });

  test("a used-up model quota delays the job and leaves the audit queued", async () => {
    const prefix = `${PREFIX}-quota`;
    const connection = redisConnection(REDIS_URL);
    const queue = createAuditQueue({ connection, prefix });
    const quota = {
      generateJson: async () => {
        throw new QuotaExhaustedError("Gemini daily quota exhausted: GenerateRequestsPerDayPerProjectPerModel-FreeTier", "GenerateRequestsPerDayPerProjectPerModel-FreeTier");
      },
    };
    let worker: Worker | undefined;
    try {
      worker = startWorker({ db: handle.db, connection: redisConnection(REDIS_URL), prefix, makeDeps: (req) => ({ ...replayDeps(req), llm: quota }), log: () => {} });
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
      await worker?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  }, 30_000);
});
