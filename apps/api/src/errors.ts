import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import type { ApiError } from "@answerable/contracts";
import { AuditError } from "@answerable/pipeline";

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
  // Errors thrown by express.json() carry a type and a status.
  const type = (err as { type?: string } | null)?.type;
  if (type === "entity.parse.failed") return { status: 400, body: body("invalid_json", "The body isn't valid JSON") };
  if (type === "entity.too.large") return { status: 413, body: body("payload_too_large", "The body is too large") };
  return { status: 500, body: body("internal", "Something went wrong") };
}

export function errorHandler(log: (message: string) => void): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const { status, body } = toApiError(err);
    if (status >= 500) log(`unhandled error: ${(err as Error)?.stack ?? String(err)}`);
    res.status(status).json(body);
  };
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
};
