import { API_URL, USE_MOCKS } from "./env";
import { httpApi } from "./http";
import type { Api } from "./types";

export { API_URL, USE_MOCKS };

/**
 * The internal app's key, from VITE_API_KEY only. It ends up in the app's bundle, so it's for
 * internal or demo use; a production deploy should call the API through a server-side proxy that
 * adds the key. The widget is a separate bundle that never imports this file.
 */
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

let api: Promise<Api> | null = null;

/** The mock layer is only loaded (and only bundled into its own chunk) when VITE_USE_MOCKS=1. */
export function getApi(): Promise<Api> {
  // Read the env inline so the build drops the mock chunk when mocks are off.
  api ??= import.meta.env.VITE_USE_MOCKS === "1" ? import("./mock").then((m) => m.mockApi()) : Promise.resolve(httpApi({ baseUrl: API_URL, apiKey: API_KEY }));
  return api;
}

export * from "./types";
