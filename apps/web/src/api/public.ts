/**
 * The widget's client: only the public, keyless endpoints. It must never import the keyed client
 * (index.ts, http.ts), so the widget bundle carries no API key.
 */
import type { ApiError, PublicAuditResult } from "@answerable/contracts";
import { API_URL } from "./env";
import { parseRetryAfter } from "./poll";
import { ApiRequestError, type PublicAuditInput } from "./types";

export interface PublicApi {
  createPublicAudit(body: PublicAuditInput): Promise<PublicAuditResult>;
  getPublicAudit(id: string): Promise<PublicAuditResult>;
  addPublicEmail(id: string, email: string): Promise<PublicAuditResult>;
}

export function publicHttpApi(baseUrl: string): PublicApi {
  const root = baseUrl.replace(/\/$/, "");
  async function call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiRequestError("Can't reach the audit service right now.", "network", 0);
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (json as ApiError | null)?.error;
      throw new ApiRequestError(err?.message ?? `Request failed (${res.status})`, err?.code ?? "http_error", res.status, parseRetryAfter(res.headers.get("retry-after")));
    }
    return json as T;
  }
  const id = encodeURIComponent;
  return {
    createPublicAudit: (body) => call("/v1/public/audits", body),
    getPublicAudit: (a) => call(`/v1/public/audits/${id(a)}`),
    addPublicEmail: (a, email) => call(`/v1/public/audits/${id(a)}/email`, { email }),
  };
}

let api: Promise<PublicApi> | null = null;

export function getPublicApi(): Promise<PublicApi> {
  // Read the env inline so the build drops the mock chunk when mocks are off.
  api ??= import.meta.env.VITE_USE_MOCKS === "1" ? import("./mock").then((m) => m.mockApi()) : Promise.resolve(publicHttpApi(API_URL));
  return api;
}
