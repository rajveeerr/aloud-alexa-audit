import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CreateAuditBody } from "@answerable/contracts";
import type { AuditRow } from "@answerable/db";
import { AuditError } from "@answerable/pipeline";
import { HttpError, toApiError } from "./errors";
import { toAuditJob, toBulkJob, toPublicResult } from "./views";

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

const report = {
  intentSet: { basis: "mined", intents: ["a", "b", "c", "d"].map((id) => ({ id, question: `Question ${id}?` })) },
  gaps: [gap("a", 5), gap("b", 40, true), gap("c", 12), gap("d", 30)],
};

describe("toPublicResult", () => {
  test("a queued audit shows only its status", () => {
    expect(toPublicResult(row(), false)).toEqual({ id: "a1", status: "queued", asin: "B0C9W8DD9S", emailCaptured: false });
  });

  test("a done audit shows the 3 highest-priority gaps with their questions, never the report", () => {
    const r = toPublicResult(row({ status: "done", score: 52, report }), true);
    expect(r.topGaps).toEqual([
      { question: "Question b?", status: "missing", competitorShare: 0.5, hiddenInImage: true },
      { question: "Question d?", status: "missing", competitorShare: 0.5, hiddenInImage: false },
      { question: "Question c?", status: "missing", competitorShare: 0.5, hiddenInImage: false },
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
});
