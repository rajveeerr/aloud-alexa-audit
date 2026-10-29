/**
 * OpenAPI 3.1 description of /v1, written by hand to match app.ts and @answerable/contracts.
 * The audit report itself is the pipeline's AuditResult; it's described loosely here because
 * it's large and the contracts package is its real reference.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ content: { "application/json": { schema } } });
const error = (description: string) => ({ description, ...json(ref("ApiError")) });
const asin = { type: "string", pattern: "^B0[A-Z0-9]{8}$", example: "B0C9W8DD9S" };
const id = { type: "string", format: "uuid" };
const pathId = { name: "id", in: "path", required: true, schema: id };
const status = { type: "string", enum: ["queued", "running", "done", "failed"] };
const origin = { type: "string", enum: ["app", "api", "widget", "rescore", "bulk"] };
const source = { type: "string", enum: ["serpapi", "dataset", "paste"] };
const keyed = { security: [{ apiKey: [] }] };
const common = {
  "400": error("Validation error"),
  "401": error("Missing or invalid API key"),
  "429": error("Rate limited"),
  "503": error("Redis or MySQL unavailable (dependency_unavailable), or the audit couldn't be queued (enqueue_failed)"),
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "answerable API",
    version: "1.0.0",
    description: "Alexa for Shopping readiness audits. Audits run on a queue: create one, then poll it until it's done or failed.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } },
      },
      PastedListing: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 500 },
          bullets: { type: "array", maxItems: 10, items: { type: "string", maxLength: 1000 } },
          description: { type: "string", maxLength: 5000 },
          attributes: { type: "object", additionalProperties: { type: "string", maxLength: 500 } },
          imageUrls: { type: "array", maxItems: 16, items: { type: "string", format: "uri" } },
        },
      },
      CreateAuditBody: {
        type: "object",
        required: ["asin"],
        properties: {
          asin,
          source: { ...source, default: "serpapi" },
          paste: { ...ref("PastedListing"), description: "Required when source is paste." },
          category: { type: "string", maxLength: 120 },
          competitors: { type: "array", maxItems: 6, items: asin },
          live: { type: "boolean", default: false, description: "Allow live SerpApi fetches. Costs searches." },
        },
      },
      AuditReport: { type: "object", description: "The pipeline's AuditResult: listing, intentSet, grades, score, imageClaims, coverage, hiddenAnswers, competitors, gaps, briefs, usage, notes." },
      AuditJob: {
        type: "object",
        required: ["id", "asin", "source", "origin", "status", "createdAt"],
        properties: {
          id,
          asin,
          source,
          origin,
          status,
          error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, description: "Set when failed." },
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          score: { type: ["integer", "null"] },
          contentHash: { type: "string" },
          note: { type: "string", description: "Why a queued audit is waiting." },
          report: { ...ref("AuditReport"), description: "Present when done." },
        },
      },
      AuditSummary: {
        type: "object",
        required: ["id", "asin", "source", "origin", "status", "createdAt"],
        properties: {
          id,
          asin,
          source,
          origin,
          status,
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          score: { type: ["integer", "null"] },
          brand: { type: "string" },
          title: { type: "string" },
          category: { type: "string" },
        },
      },
      StudioBriefs: {
        type: "object",
        required: ["auditId", "asin", "category", "briefs"],
        properties: { auditId: id, asin, category: { type: "string" }, briefs: { type: "array", items: { type: "object" } } },
      },
      AsinHistory: {
        type: "object",
        required: ["asin", "points"],
        properties: {
          asin,
          points: {
            type: "array",
            items: {
              type: "object",
              required: ["auditId", "at", "score", "contentHash", "origin"],
              properties: { auditId: id, at: { type: "string", format: "date-time" }, score: { type: ["integer", "null"] }, contentHash: { type: "string" }, origin },
            },
          },
        },
      },
      RescoreResult: {
        oneOf: [
          { type: "object", required: ["skipped", "reason", "auditId"], properties: { skipped: { const: true }, reason: { const: "unchanged" }, auditId: id } },
          { type: "object", required: ["skipped", "auditId"], properties: { skipped: { const: false }, auditId: id } },
        ],
      },
      BulkJob: {
        type: "object",
        required: ["id", "name", "status", "total", "done", "failed", "createdAt", "audits"],
        properties: {
          id,
          name: { type: "string" },
          status: { type: "string", enum: ["running", "done"] },
          total: { type: "integer" },
          done: { type: "integer" },
          failed: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          audits: {
            type: "array",
            items: { type: "object", required: ["id", "asin", "status", "score"], properties: { id, asin, status, score: { type: ["integer", "null"] } } },
          },
        },
      },
      PublicAuditResult: {
        type: "object",
        required: ["id", "status", "asin", "emailCaptured"],
        properties: {
          id,
          status,
          asin,
          score: { type: ["integer", "null"] },
          scoreBasis: { type: "string", enum: ["mined", "estimated"] },
          topGaps: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              required: ["question", "status", "competitorShare", "competitorsAnswering", "competitors", "hiddenInImage"],
              properties: {
                question: { type: "string" },
                status: { type: "string" },
                competitorShare: { type: ["number", "null"], description: "Answered counts 1, partial 0.5. For ranking." },
                competitorsAnswering: { type: "integer", description: "Competitors that answer it, fully or partly." },
                competitors: { type: "integer", description: "Competitors the question applies to." },
                hiddenInImage: { type: "boolean" },
              },
            },
          },
          emailCaptured: { type: "boolean" },
          reason: { type: "string", description: "When failed: a short reason safe to show a visitor." },
        },
      },
      SavedListing: {
        type: "object",
        required: ["asin", "source", "title"],
        properties: { asin, source: { type: "string", enum: ["serpapi", "dataset"] }, brand: { type: "string" }, title: { type: "string" }, category: { type: "string" } },
      },
      Health: {
        type: "object",
        required: ["ok", "db", "redis"],
        properties: { ok: { type: "boolean" }, db: { type: "boolean" }, redis: { type: "boolean" } },
      },
    },
  },
  paths: {
    "/v1/health": {
      get: { summary: "Database and Redis reachability", responses: { "200": { description: "Healthy", ...json(ref("Health")) }, "503": { description: "A dependency is down", ...json(ref("Health")) } } },
    },
    "/v1/openapi.json": { get: { summary: "This document", responses: { "200": { description: "OpenAPI 3.1 document" } } } },
    "/v1/listings": {
      get: {
        summary: "Saved listings to offer as demo products",
        parameters: [{ name: "source", in: "query", schema: { type: "string", enum: ["serpapi", "dataset"] } }],
        responses: { "200": { description: "Saved listings", ...json({ type: "array", items: ref("SavedListing") }) }, "400": error("Bad source") },
      },
    },
    "/v1/audits": {
      post: {
        ...keyed,
        summary: "Queue an audit",
        description: "Send x-answerable-origin: app from the web app; anything else is recorded as an API audit.",
        requestBody: { required: true, ...json(ref("CreateAuditBody")) },
        responses: {
          "202": { description: "Queued", ...json({ type: "object", required: ["id", "status"], properties: { id, status } }) },
          ...common,
        },
      },
      get: {
        ...keyed,
        summary: "Recent audits, newest first",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }],
        responses: { "200": { description: "Audits", ...json({ type: "array", items: ref("AuditSummary") }) }, ...common },
      },
    },
    "/v1/audits/{id}": {
      get: {
        ...keyed,
        summary: "An audit's status, and its report once done",
        parameters: [pathId],
        responses: { "200": { description: "The audit", ...json(ref("AuditJob")) }, ...common, "404": error("No such audit") },
      },
    },
    "/v1/audits/{id}/briefs": {
      post: {
        ...keyed,
        summary: "Studio-ready briefs for a done audit",
        parameters: [pathId],
        responses: { "200": { description: "Briefs", ...json(ref("StudioBriefs")) }, ...common, "404": error("No such audit"), "409": error("The audit isn't done yet") },
      },
    },
    "/v1/asins/{asin}/history": {
      get: {
        ...keyed,
        summary: "Score over time for an ASIN (done audits, oldest first)",
        parameters: [{ name: "asin", in: "path", required: true, schema: asin }],
        responses: { "200": { description: "History", ...json(ref("AsinHistory")) }, ...common },
      },
    },
    "/v1/rescore": {
      post: {
        ...keyed,
        summary: "Re-audit a listing if its content changed",
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["asin", "reason"],
            properties: { asin, source: { type: "string", enum: ["serpapi", "dataset"], default: "serpapi" }, reason: { type: "string", maxLength: 200 } },
          }),
        },
        responses: {
          "200": { description: "Unchanged, skipped", ...json(ref("RescoreResult")) },
          "202": { description: "Changed, a new audit was queued", ...json(ref("RescoreResult")) },
          ...common,
          "404": error("No saved listing"),
        },
      },
    },
    "/v1/bulk": {
      post: {
        ...keyed,
        summary: "Queue one audit per ASIN",
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["name", "asins"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 120 },
              asins: { type: "array", minItems: 1, maxItems: 200, items: asin },
              source: { type: "string", enum: ["serpapi", "dataset"], default: "serpapi" },
              live: { type: "boolean", default: false },
            },
          }),
        },
        responses: { "202": { description: "Queued", ...json({ type: "object", required: ["id"], properties: { id } }) }, ...common },
      },
      get: {
        ...keyed,
        summary: "The newest bulk jobs with their progress",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } }],
        responses: {
          "200": {
            description: "Newest first, without the per-audit rows (see GET /v1/bulk/{id})",
            ...json({
              type: "array",
              items: {
                type: "object",
                required: ["id", "name", "status", "total", "done", "failed", "createdAt"],
                properties: {
                  id,
                  name: { type: "string" },
                  status: { type: "string", enum: ["running", "done"] },
                  total: { type: "integer" },
                  done: { type: "integer" },
                  failed: { type: "integer" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            }),
          },
          ...common,
        },
      },
    },
    "/v1/bulk/{id}": {
      get: {
        ...keyed,
        summary: "Bulk job progress",
        parameters: [pathId],
        responses: { "200": { description: "Progress", ...json(ref("BulkJob")) }, ...common, "404": error("No such bulk job") },
      },
    },
    "/v1/public/audits": {
      post: {
        summary: "Widget audit: no key, limited per IP",
        requestBody: {
          required: true,
          ...json({ type: "object", required: ["asin"], properties: { asin, email: { type: "string", format: "email" } } }),
        },
        responses: { "202": { description: "Queued", ...json(ref("PublicAuditResult")) }, "400": error("Validation error"), "429": error("Too many audits from this IP"), "503": error("A backing service is unavailable") },
      },
    },
    "/v1/public/audits/{id}/email": {
      post: {
        summary: "Leave an email for a widget audit: unlocks the full report. Its own per-IP limit; the same email twice is stored once",
        parameters: [pathId],
        requestBody: { required: true, ...json({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } }) },
        responses: {
          "202": { description: "Lead stored", ...json(ref("PublicAuditResult")) },
          "400": error("Validation error"),
          "404": error("No such widget audit"),
          "429": error("Too many requests from this IP"),
          "503": error("A backing service is unavailable"),
        },
      },
    },
    "/v1/public/audits/{id}": {
      get: {
        summary: "Widget audit result: score and the top 3 gaps only",
        parameters: [pathId],
        responses: { "200": { description: "Result", ...json(ref("PublicAuditResult")) }, "400": error("Bad id"), "404": error("No such widget audit") },
      },
    },
  },
} as const;
