import type { ApiError } from "@aloud/contracts";
import { parseRetryAfter } from "./poll";
import { ApiRequestError, type Api } from "./types";

type Options = { baseUrl: string; apiKey: string };

export function httpApi({ baseUrl, apiKey }: Options): Api {
  const root = baseUrl.replace(/\/$/, "");

  /** `key: false` for public endpoints such as the demo listings. */
  async function call<T>(path: string, init: { method?: string; body?: unknown; key?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.key !== false) {
      headers["x-api-key"] = apiKey;
      // The API records where an audit came from; without this it counts as an API integration.
      headers["x-aloud-origin"] = "app";
    }

    let res: Response;
    try {
      res = await fetch(`${root}${path}`, {
        method: init.method ?? "GET",
        headers,
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      });
    } catch {
      throw new ApiRequestError(`Can't reach the API at ${root}. Is it running?`, "network", 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok) throw new ApiRequestError(`The API sent a response that isn't JSON (${path})`, "bad_response", res.status);
    }
    if (!res.ok) {
      const err = (json as ApiError | null)?.error;
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      throw new ApiRequestError(err?.message ?? `Request failed (${res.status})`, err?.code ?? "http_error", res.status, retryAfterMs);
    }
    return json as T;
  }

  const id = encodeURIComponent;
  return {
    mode: "http",
    createAudit: (body) => call("/v1/audits", { method: "POST", body }),
    getAudit: (a) => call(`/v1/audits/${id(a)}`),
    listAudits: (limit = 50) => call(`/v1/audits?limit=${limit}`),
    createBriefs: (a) => call(`/v1/audits/${id(a)}/briefs`, { method: "POST", body: {} }),
    history: (asin) => call(`/v1/asins/${id(asin)}/history`),
    rescore: (body) => call("/v1/rescore", { method: "POST", body }),
    createBulk: (body) => call("/v1/bulk", { method: "POST", body }),
    getBulk: (b) => call(`/v1/bulk/${id(b)}`),
    listBulk: (limit = 10) => call(`/v1/bulk?limit=${limit}`),
    listings: (source) => call(`/v1/listings?source=${source}`, { key: false }),
  };
}
