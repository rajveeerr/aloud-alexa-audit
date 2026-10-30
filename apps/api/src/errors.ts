import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import type { ApiError } from "@aloud/contracts";
import { AuditError } from "@aloud/pipeline";
import { EnqueueError, isRedisDown } from "@aloud/worker";

/** Throw from a route to answer with that status and code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const DB_DOWN_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR"]);

/**
 * Redis or MySQL being unreachable is a 503 the client can retry, not a 500 bug.
 * Drizzle wraps driver errors, so the cause chain is checked too.
 */
export function isDependencyDown(err: unknown): boolean {
  for (let e = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (isRedisDown(e)) return true;
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && DB_DOWN_CODES.has(code)) return true;
  }
  return false;
}

/** Every failure becomes the same ApiError shape, so clients handle errors one way. */
export function toApiError(err: unknown): { status: number; body: ApiError } {
  const body = (code: string, message: string, details?: unknown): ApiError => ({ error: { code, message, ...(details !== undefined && { details }) } });

  if (err instanceof HttpError) return { status: err.status, body: body(err.code, err.message, err.details) };
  if (err instanceof z.ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    return { status: 400, body: body("validation_error", "The request is invalid", details) };
  }
  if (err instanceof AuditError) {
    return err.code === "listing_not_found" ? { status: 404, body: body(err.code, err.message) } : { status: 400, body: body(err.code, err.message) };
  }
  if (err instanceof EnqueueError) return { status: 503, body: body("enqueue_failed", err.message, { auditIds: err.auditIds }) };
  if (isDependencyDown(err)) return { status: 503, body: body("dependency_unavailable", "A backing service is unavailable. Try again shortly.") };
  // Errors thrown by express.json() carry a type and a status.
  const type = (err as { type?: string } | null)?.type;
  if (type === "entity.parse.failed") return { status: 400, body: body("invalid_json", "The body isn't valid JSON") };
  if (type === "entity.too.large") return { status: 413, body: body("payload_too_large", "The body is too large") };
  return { status: 500, body: body("internal", "Something went wrong") };
}

export function errorHandler(log: (message: string) => void): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const { status, body } = toApiError(err);
    if (status === 503) log(`dependency unavailable: ${(err as Error)?.message ?? String(err)}`);
    else if (status >= 500) log(`unhandled error: ${(err as Error)?.stack ?? String(err)}`);
    res.status(status).json(body);
  };
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
};
