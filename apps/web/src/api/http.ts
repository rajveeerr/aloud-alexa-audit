import type { ApiError } from "@answerable/contracts";
import { ApiRequestError, type Api } from "./types";

type Options = { baseUrl: string; apiKey: string };

/** List endpoints return an array; tolerate a `{ items }` style wrapper too. */
function asList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const first = Object.values(body).find(Array.isArray);
    if (first) return first as T[];
  }
  return [];
}

export function httpApi({ baseUrl, apiKey }: Options): Api {
  const root = baseUrl.replace(/\/$/, "");

  async function call<T>(path: string, init: { method?: string; body?: unknown; key?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.key !== false) headers["x-api-key"] = apiKey;

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
      throw new ApiRequestError(err?.message ?? `Request failed (${res.status})`, err?.code ?? "http_error", res.status);
    }
    return json as T;
  }

  return {
    mode: "http",
    createAudit: (body) => call("/v1/audits", { method: "POST", body }),
    getAudit: (id) => call(`/v1/audits/${encodeURIComponent(id)}`),
    listAudits: async (limit = 50) => asList(await call(`/v1/audits?limit=${limit}`)),
    createBriefs: (id) => call(`/v1/audits/${encodeURIComponent(id)}/briefs`, { method: "POST", body: {} }),
    history: (asin) => call(`/v1/asins/${encodeURIComponent(asin)}/history`),
    rescore: (body) => call("/v1/rescore", { method: "POST", body }),
    createBulk: (body) => call("/v1/bulk", { method: "POST", body }),
    getBulk: (id) => call(`/v1/bulk/${encodeURIComponent(id)}`),
    listBulk: async () => asList(await call("/v1/bulk")),
    createPublicAudit: (body) => call("/v1/public/audits", { method: "POST", body, key: false }),
    getPublicAudit: (id) => call(`/v1/public/audits/${encodeURIComponent(id)}`, { key: false }),
    listings: async (source) => asList(await call(`/v1/listings?source=${source}`)),
  };
}
