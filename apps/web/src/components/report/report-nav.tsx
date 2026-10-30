import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NavItem = { id: string; label: string; count?: number | string | undefined };

/** Which section is under the sticky bars: the last one whose top has scrolled past them. */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = 140;
      let current: string | null = null;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      // At the very bottom, the last section is the one being read even if it's short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = els[els.length - 1]!.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);

  return active;
}

/** The report's sticky section bar: where you are, how much is in each section, and the hand-off. */
export function ReportNav({ items, action }: { items: NavItem[]; action?: ReactNode }) {
  const active = useActiveSection(items.map((i) => i.id));
  return (
    <nav aria-label="Report sections" className="sticky top-14 z-30 -mx-4 border-b bg-background/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-3">
        <ul className="-mx-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto py-2 [scrollbar-width:none]">
          {items.map((j) => {
            const on = active === j.id;
            return (
              <li key={j.id}>
                <a
                  href={`#${j.id}`}
                  aria-current={on ? "location" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
                    on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {j.label}
                  {j.count !== undefined && (
                    <span className={cn("rounded-full px-1.5 text-[11.5px] tabular-nums", on ? "bg-background/20" : "bg-muted text-foreground/70")}>{j.count}</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </nav>
  );
}
