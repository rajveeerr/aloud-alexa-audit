import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/app-shell";
import { AuditPage } from "@/pages/audit";
import { AuditsPage } from "@/pages/audits";
import { BulkPage } from "@/pages/bulk";
import { IntegrationsPage } from "@/pages/integrations";
import { LandingPage } from "@/pages/landing";
import { NotFoundPage } from "@/pages/not-found";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/audits", element: <AuditsPage /> },
      { path: "/audits/:id", element: <AuditPage /> },
      { path: "/bulk", element: <BulkPage /> },
      { path: "/integrations", element: <IntegrationsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
