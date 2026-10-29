/** Settings both bundles may read. The API key is deliberately not here: only the internal app reads it (api/index.ts). */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "1";
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4100";
