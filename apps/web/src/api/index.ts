import { httpApi } from "./http";
import type { Api } from "./types";

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "1";
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4100";

let api: Promise<Api> | null = null;

/** The mock layer is only loaded (and only bundled into its own chunk) when VITE_USE_MOCKS=1. */
export function getApi(): Promise<Api> {
  api ??= USE_MOCKS
    ? import("./mock").then((m) => m.mockApi())
    : Promise.resolve(httpApi({ baseUrl: API_URL, apiKey: import.meta.env.VITE_API_KEY ?? "dev-key" }));
  return api;
}

export * from "./types";
