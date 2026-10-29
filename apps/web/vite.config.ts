import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** API_PROXY=http://localhost:4100 serves /v1 from the dev server's own origin, so CORS never applies (used by the real-stack e2e). */
const proxy = process.env.API_PROXY;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5180, strictPort: true, ...(proxy && { proxy: { "/v1": { target: proxy, changeOrigin: true } } }) },
  preview: { port: 5181, strictPort: true },
  // Two pages, two bundles: the internal app, and the widget, which must never carry the API key.
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        widget: fileURLToPath(new URL("./widget.html", import.meta.url)),
      },
    },
  },
});
