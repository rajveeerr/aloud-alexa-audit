import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { competitorCounts, countsLabel, isEstimated, STATUS_LABEL, type Grade, type GradeStatus, type Report, demand } from "@/lib/report";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { StatusIcon, StatusLegend } from "./status";

function Cell({ grade }: { grade: Grade | undefined }) {
  const status = grade?.status ?? "missing";
  const quote = grade?.quotes[0]?.text;
  return (
    <span className="flex justify-center" title={quote ? `${STATUS_LABEL[status]}: “${quote}”` : STATUS_LABEL[status]}>
      <StatusIcon status={status} className="size-[22px] [&_svg]:size-3" />
      {!grade && <span className="sr-only">(not graded)</span>}
    </span>
  );
}

export function GapMatrix({ report }: { report: Report }) {
  const estimated = isEstimated(report);
  const comps = report.competitors;
  const gapIds = new Set(report.gaps.map((g) => g.intentId));
  const mine = new Map(report.grades.map((g) => [g.intentId, g]));
  const theirs = comps.map((c) => new Map(c.grades.map((g) => [g.intentId, g])));
  // A question that applies to none of the products (glitter, scent) is noise here.
  const applies = (id: string) => [mine, ...theirs].some((m) => m.get(id)?.status !== "not_applicable");
  const all = report.intentSet.intents
    .filter((i) => i.kind !== "experience" && applies(i.id))
    .sort((a, b) => Number(gapIds.has(b.id)) - Number(gapIds.has(a.id)) || b.frequency - a.frequency);
  const gapCount = all.filter((i) => gapIds.has(i.id)).length;
  const [showAll, setShowAll] = useState(gapCount === 0);
  const rows = showAll ? all : all.filter((i) => gapIds.has(i.id));
  const name = report.listing.meta.brand ?? report.listing.asin;
  const statuses = (["answered", "partial", "missing", "contradicted", "not_applicable"] as GradeStatus[]).filter((s) =>
    all.some((i) => [mine, ...theirs].some((m) => (m.get(i.id)?.status ?? "missing") === s)),
  );

  return (
    <Section id="competitors" title="Against competitors">
      {comps.length === 0 && (
        <p className="text-[15px] text-muted-foreground">No competitors were found for this audit, so gaps are ranked without a comparison.</p>
      )}
      {comps.length > 0 && (
        <div>
          <StatusLegend statuses={statuses} className="mb-3" />
          <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
            <div className={cn("relative overflow-auto overscroll-x-contain", showAll && "max-h-[min(70vh,720px)]")}>
              <table className="w-full min-w-[620px] border-separate border-spacing-0 text-sm">
                <caption className="sr-only">Each question's status for this product and each competitor</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky top-0 left-0 z-30 border-b bg-[#fcfbf9] px-4 py-3 text-left text-[13px] font-semibold text-muted-foreground">
                      Question
                    </th>
                    <th scope="col" className="sticky top-0 z-20 w-[112px] border-b border-b-[#f5c48a] bg-tint-strong px-2 py-2.5 text-center">
                      <span className="block text-[13px] font-bold">{name}</span>
                      <span className="block text-[11.5px] font-semibold text-[#9a3412] tabular-nums">This listing · {report.score.score ?? "n/a"}</span>
                    </th>
                    {comps.map((c) => (
                      <th key={c.asin} scope="col" className="sticky top-0 z-20 w-[104px] border-b bg-[#fcfbf9] px-2 py-2.5 text-center font-semibold">
                        <span className="block truncate text-[13px]" title={c.asin}>
                          {c.brand ?? c.asin}
                        </span>
                        <span className="block text-[11.5px] font-normal text-muted-foreground tabular-nums">score {c.score.score ?? "n/a"}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const isGap = gapIds.has(i.id);
                    const counts = competitorCounts(report, i.id);
                    return (
                      <tr key={i.id} className="group">
                        <th scope="row" className="sticky left-0 z-10 max-w-[190px] min-w-[170px] border-b sm:max-w-[300px] bg-card px-4 py-2.5 text-left font-normal group-last:border-b-0 group-hover:bg-[#fcfbf9]">
                          <span className="line-clamp-2 leading-snug font-semibold">{i.question}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                            {isGap && <span className="rounded-full bg-tint-strong px-1.5 py-px font-semibold text-[#9a3412]">Gap</span>}
                            {!estimated && <span>{demand(report, i.frequency, "short")}</span>}
                            {isGap && counts.competitors > 0 && <span>{countsLabel(counts)}</span>}
                          </span>
                        </th>
                        <td className="border-b bg-tint/70 px-2 py-2.5 group-last:border-b-0">
                          <Cell grade={mine.get(i.id)} />
                        </td>
                        {theirs.map((m, n) => (
                          <td key={comps[n]!.asin} className="border-b px-2 py-2.5 group-last:border-b-0 group-hover:bg-[#fcfbf9]">
                            <Cell grade={m.get(i.id)} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {gapCount > 0 && gapCount < all.length && (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((s) => !s)}
                className="flex w-full items-center justify-center gap-1.5 border-t bg-[#fcfbf9] px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {showAll ? `Show only the ${gapCount} gaps` : `Show all ${all.length} questions`}
                <ChevronDownIcon className={cn("size-4 transition-transform duration-200", showAll && "rotate-180")} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
