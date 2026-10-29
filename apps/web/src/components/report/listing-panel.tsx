import { useEffect, useRef } from "react";
import { highlight } from "@/lib/highlight";
import type { Field, Report } from "@/lib/report";
import { cn } from "@/lib/utils";

const GROUPS: { kind: Field["kind"]; label: string }[] = [
  { kind: "title", label: "Title" },
  { kind: "bullet", label: "Bullets" },
  { kind: "description", label: "Description" },
  { kind: "aplus", label: "A+ text" },
  { kind: "attribute", label: "Attributes" },
];

type Quote = { fieldId: string; text: string };

/**
 * Every readable field with its id, so any quote in the report can be found in place.
 * `selected` quotes are marked strongly and scrolled to; all other verified quotes are marked softly.
 */
export function ListingPanel({ report, selected, all }: { report: Report; selected: Quote[]; all: Quote[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstId = selected[0]?.fieldId;

  useEffect(() => {
    const box = scroller.current;
    if (!box || !firstId) return;
    // Only scroll inside the panel, and only when it is its own scroll area (wide screens).
    if (box.scrollHeight <= box.clientHeight) return;
    const el = box.querySelector<HTMLElement>(`[data-field="${CSS.escape(firstId)}"]`);
    if (el) box.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  }, [firstId, selected]);

  const byField = (quotes: Quote[], id: string) => quotes.filter((q) => q.fieldId === id).map((q) => q.text);

  return (
    <section aria-labelledby="listing-title" className="rounded-xl border">
      <div className="border-b px-4 py-3">
        <h3 id="listing-title" className="text-[15px] font-semibold">
          Listing text
        </h3>
        <p className="text-[13px] text-muted-foreground">What Alexa can read. Quotes are marked where they appear.</p>
      </div>
      <div ref={scroller} className="relative px-4 pb-4 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto" tabIndex={0} aria-label="Listing fields">
        {GROUPS.map((g) => {
          const fields = report.listing.fields.filter((f) => f.kind === g.kind);
          if (fields.length === 0) return null;
          return (
            <div key={g.kind} className="pt-4">
              <h4 className="text-[13px] font-semibold text-muted-foreground">{g.label}</h4>
              <dl className={cn("mt-1.5", g.kind === "attribute" ? "grid gap-1" : "grid gap-2.5")}>
                {fields.map((f) => {
                  const strong = byField(selected, f.id);
                  const spans = highlight(f.text, strong, byField(all, f.id));
                  return (
                    <div key={f.id} data-field={f.id} className={cn("rounded-md px-2 py-1.5 -mx-2", strong.length > 0 && "bg-tint")}>
                      <dt className="font-mono text-[11.5px] text-muted-foreground">{f.id}</dt>
                      <dd className={cn("text-sm leading-relaxed", g.kind === "title" && "font-semibold")}>
                        {spans.map((s, i) =>
                          s.mark ? (
                            <mark
                              key={i}
                              className={cn(
                                "rounded-[3px] text-inherit",
                                s.mark === "strong" ? "bg-primary/35 px-0.5 font-semibold" : "bg-transparent underline decoration-[#f5b56a] decoration-2 underline-offset-[3px]",
                              )}
                            >
                              {s.text}
                            </mark>
                          ) : (
                            <span key={i}>{s.text}</span>
                          ),
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
