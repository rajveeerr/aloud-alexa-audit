import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CreateAuditBody } from "@aloud/contracts";
import type { AuditRow } from "@aloud/db";
import { AuditError } from "@aloud/pipeline";
import { EnqueueError } from "@aloud/worker";
import { HttpError, toApiError } from "./errors";
import { configFromEnv, parseTrustProxy } from "./server";
import { publicReason, toAuditJob, toBulkJob, toBulkSummary, toPublicResult } from "./views";

const at = new Date("2026-10-30T12:00:00Z");

function row(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "a1",
    asin: "B0C9W8DD9S",
    requestedAsin: "B0C9W8DD9S",
    source: "serpapi",
    origin: "widget",
    status: "queued",
    request: {},
    score: null,
    basis: null,
    categoryId: null,
    categoryName: null,
    brand: null,
    title: null,
    contentHash: null,
    report: null,
    usage: null,
    error: null,
    note: null,
    bulkJobId: null,
    createdAt: at,
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

const gap = (intentId: string, priority: number, hidden = false) => ({
  intentId,
  status: "missing",
  frequency: 10,
  competitorShare: 0.5,
  competitorsAnswering: [],
  hiddenClaims: hidden ? [{ id: "c1", text: "Quick dry", imageIds: ["img.1"] }] : [],
  priority,
});

const grade = (intentId: string, status: string) => ({ intentId, status });

const report = {
  intentSet: { basis: "mined", intents: ["a", "b", "c", "d"].map((id) => ({ id, question: `Question ${id}?` })) },
  gaps: [gap("a", 5), gap("b", 40, true), gap("c", 12), gap("d", 30)],
  // b: one answers, one partly, one doesn't apply. d: one answers, two miss.
  competitors: [
    { grades: [grade("b", "answered"), grade("d", "answered"), grade("c", "missing")] },
    { grades: [grade("b", "partial"), grade("d", "missing")] },
    { grades: [grade("b", "not_applicable"), grade("d", "missing")] },
  ],
};

describe("toPublicResult", () => {
  test("a queued audit shows only its status", () => {
    expect(toPublicResult(row(), false)).toEqual({ id: "a1", status: "queued", asin: "B0C9W8DD9S", emailCaptured: false });
  });

  test("a done audit shows the 3 highest-priority gaps with their questions, never the report", () => {
    const r = toPublicResult(row({ status: "done", score: 52, report }), true);
    expect(r.topGaps).toEqual([
      { question: "Question b?", status: "missing", competitorShare: 0.5, competitorsAnswering: 2, competitors: 2, hiddenInImage: true },
      { question: "Question d?", status: "missing", competitorShare: 0.5, competitorsAnswering: 1, competitors: 3, hiddenInImage: false },
      { question: "Question c?", status: "missing", competitorShare: 0.5, competitorsAnswering: 0, competitors: 1, hiddenInImage: false },
    ]);
    expect(r).toMatchObject({ score: 52, scoreBasis: "mined", emailCaptured: true });
    expect(r).not.toHaveProperty("report");
  });
});

describe("toAuditJob", () => {
  test("the report and score only appear once done; errors only when failed", () => {
    expect(toAuditJob(row({ report }))).not.toHaveProperty("report");
    expect(toAuditJob(row())).not.toHaveProperty("score");
    const failed = toAuditJob(row({ status: "failed", error: { code: "listing_not_found", message: "no" }, completedAt: at }));
    expect(failed).toMatchObject({ error: { code: "listing_not_found" }, completedAt: at.toISOString() });
    expect(toAuditJob(row({ status: "done", score: null, report }))).toMatchObject({ score: null, report });
  });
});

describe("toBulkJob", () => {
  const job = { id: "b1", name: "trio", source: "dataset" as const, total: 3, createdAt: at };

  test("is running until every audit has finished, failed ones included", () => {
    const audits = [
      { id: "1", asin: "B000000001", status: "done" as const, score: 80 },
      { id: "2", asin: "B000000002", status: "failed" as const, score: null },
      { id: "3", asin: "B000000003", status: "running" as const, score: null },
    ];
    expect(toBulkJob(job, audits)).toMatchObject({ status: "running", done: 1, failed: 1, total: 3 });
    expect(toBulkJob(job, audits.map((a) => (a.id === "3" ? { ...a, status: "done" as const } : a)))).toMatchObject({ status: "done", done: 2, failed: 1 });
  });
});

describe("toBulkSummary", () => {
  test("has the progress counts and never the audit rows", () => {
    const job = { id: "b1", name: "trio", source: "dataset" as const, total: 3, createdAt: at };
    expect(toBulkSummary(job, 2, 1)).toEqual({ id: "b1", name: "trio", status: "done", total: 3, done: 2, failed: 1, createdAt: at.toISOString() });
    expect(toBulkSummary(job, 1, 0)).toMatchObject({ status: "running" });
  });
});

describe("toApiError", () => {
  test("validation errors are 400 with each issue's path", () => {
    const parsed = CreateAuditBody.safeParse({ asin: "x" });
    const { status, body } = toApiError(parsed.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details).toEqual([{ path: "asin", message: "An ASIN is 10 characters starting with B0" }]);
  });

  test("HttpError keeps its status and code", () => {
    expect(toApiError(new HttpError(409, "not_done", "wait"))).toEqual({ status: 409, body: { error: { code: "not_done", message: "wait" } } });
  });

  test("audit errors map to 404 and 400", () => {
    expect(toApiError(new AuditError("gone", "listing_not_found")).status).toBe(404);
    expect(toApiError(new AuditError("bad", "bad_request")).status).toBe(400);
  });

  test("bad JSON is 400; anything unknown is a 500 that hides the message", () => {
    expect(toApiError(Object.assign(new SyntaxError("Unexpected token"), { type: "entity.parse.failed" })).body.error.code).toBe("invalid_json");
    expect(toApiError(new Error("db password is hunter2"))).toEqual({ status: 500, body: { error: { code: "internal", message: "Something went wrong" } } });
    expect(toApiError(new z.ZodError([])).status).toBe(400);
  });

  test("an unreachable Redis or MySQL is a 503, including when wrapped", () => {
    const redisDown = Object.assign(new Error("Reached the max retries per request limit (which is 1)."), { name: "MaxRetriesPerRequestError" });
    expect(toApiError(redisDown)).toMatchObject({ status: 503, body: { error: { code: "dependency_unavailable" } } });
    const dbDown = new Error("Failed query: select 1", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    expect(toApiError(dbDown).status).toBe(503);
  });

  test("an audit that couldn't be queued is a 503 naming the failed audits", () => {
    expect(toApiError(new EnqueueError(["a1"], new Error("redis down")))).toMatchObject({
      status: 503,
      body: { error: { code: "enqueue_failed", details: { auditIds: ["a1"] } } },
    });
  });
});

describe("public failure reasons", () => {
  test("a failed widget audit gets a fixed, safe sentence, never the stored message", () => {
    const r = toPublicResult(row({ status: "failed", error: { code: "internal", message: "stack trace with secrets" } }), false);
    expect(r.reason).toBe("The audit couldn't be completed.");
    expect(JSON.stringify(r)).not.toContain("secrets");
    expect(publicReason("listing_not_found")).toContain("can't audit this product");
    expect(publicReason("provider_unavailable")).toContain("try again");
  });
});

describe("parseTrustProxy", () => {
  const warnings: string[] = [];
  const warn = (m: string) => void warnings.push(m);

  test("unset or zero ignores X-Forwarded-For", () => {
    expect(parseTrustProxy(undefined, warn)).toBe(false);
    expect(parseTrustProxy("", warn)).toBe(false);
    expect(parseTrustProxy("0", warn)).toBe(false);
  });

  test("a hop count is used as is", () => {
    expect(parseTrustProxy("1", warn)).toBe(1);
    expect(parseTrustProxy("2", warn)).toBe(2);
  });

  test('"true" becomes 1 hop with a warning; anything else is refused', () => {
    expect(parseTrustProxy("true", warn)).toBe(1);
    expect(warnings.at(-1)).toContain("hop count");
    expect(() => parseTrustProxy("loopback", warn)).toThrow("hop count");
  });
});

describe("configFromEnv", () => {
  test("DEMO_READONLY is off unless it is exactly 1", () => {
    expect(configFromEnv({}, []).demoReadonly).toBe(false);
    expect(configFromEnv({ DEMO_READONLY: "true" }, []).demoReadonly).toBe(false);
    expect(configFromEnv({ DEMO_READONLY: "1" }, []).demoReadonly).toBe(true);
  });

  test("the dev key is never seeded in production", () => {
    expect(configFromEnv({ API_KEY_DEV: "dev-key" }, []).devApiKey).toBe("dev-key");
    expect(configFromEnv({ API_KEY_DEV: "dev-key", NODE_ENV: "production" }, []).devApiKey).toBeNull();
  });
});
