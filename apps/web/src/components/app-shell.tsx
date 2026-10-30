import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { USE_MOCKS } from "@/api";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "New audit", end: true },
  { to: "/audits", label: "Audits", end: false },
  { to: "/bulk", label: "Bulk", end: false },
  { to: "/integrations", label: "Integrations", end: false },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[17px] leading-none font-bold", className)}>
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#FF8800" />
        <path d="M9 17.5l4.5 4.5L23 11" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Aloud
    </span>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="flex h-8 shrink-0 items-center rounded-md" aria-label="Aloud, new audit">
            <Logo />
          </Link>
          <nav aria-label="Main" className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-8 items-center rounded-md px-2.5 text-sm leading-none font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-muted text-foreground",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
            {/* The widget is its own page and bundle (widget.html), so a plain link, not a route. */}
            <a
              href="/widget.html"
              className="inline-flex h-8 items-center rounded-md px-2.5 text-sm leading-none font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            >
              Widget
            </a>
          </nav>
          {USE_MOCKS && (
            <Tip content="Running on saved reports from the real pipeline. Nothing is sent to an API.">
              <span tabIndex={0} className="hidden shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground sm:inline-flex">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                Demo data
              </span>
            </Tip>
          )}
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-[13px] text-muted-foreground sm:px-6">
          <span>Aloud measures what Alexa reads on a listing. It doesn't query Alexa.</span>
          <span>Built for SalesDuo</span>
        </div>
      </footer>
    </div>
  );
}

/** Page width and padding shared by every app screen. */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10", className)}>{children}</div>;
}
