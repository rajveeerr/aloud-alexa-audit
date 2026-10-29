/**
 * The homepage widget's own entry and bundle. It talks only to the public, keyless endpoints, so
 * it can be embedded on salesduo.com without shipping the internal app or its API key.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WidgetPage } from "./widget-page";
import "../index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WidgetPage />
    </QueryClientProvider>
  </StrictMode>,
);
