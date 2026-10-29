import { isEstimated, type Grade, type GradeStatus, type Report } from "@/lib/report";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { StatusIcon } from "./status";

const SHORT: Record<GradeStatus, string> = {
  answered: "Answered",
  partial: "Partly",
  missing: "Missing",
  contradicted: "Contradicts",
  not_applicable: "n/a",
};

function Cell({ grade, quote }: { grade: Grade | undefined; quote?: string | undefined }) {
  const status = grade?.status ?? "missing";
  return (
    <div className="flex items-center gap-1.5" title={quote ? `“${quote}”` : undefined}>
      <StatusIcon status={status} className="size-5 [&_svg]:size-3" />
      <span className={cn("text-[13px]", status === "not_applicable" ? "text-na" : "text-foreground")}>{SHORT[status]}</span>
      {!grade && <span className="sr-only">(not graded)</span>}
    </div>
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
  const rows = report.intentSet.intents.filter((i) => i.kind !== "experience" && applies(i.id)).sort((a, b) => b.frequency - a.frequency);
  const name = report.listing.meta.brand ?? report.listing.asin;

  return (
    <Section
      id="competitors"
      title="Against competitors"
      description={
        comps.length === 0
          ? "No competitors were found for this audit, so gaps are ranked without a comparison."
          : `The same questions graded on ${comps.length} competing listings in ${report.intentSet.categoryName}. Rows with an orange edge are gaps: this listing falls short where competitors don't.`
      }
    >
      {comps.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">Each question's status for this product and each competitor</caption>
              <thead>
                <tr className="border-b bg-muted/60">
                  <th scope="col" className="sticky left-0 z-10 bg-[#f9f8f6] px-4 py-3 text-left font-semibold">
                    Question
                  </th>
                  <th scope="col" className="bg-tint px-3 py-3 text-left font-semibold whitespace-nowrap">
                    {name}
                    <span className="block text-xs font-normal text-muted-foreground">This listing, {report.score.score ?? "n/a"}</span>
                  </th>
                  {comps.map((c) => (
                    <th key={c.asin} scope="col" className="px-3 py-3 text-left font-semibold whitespace-nowrap">
                      {c.brand ?? c.asin}
                      <span className="block text-xs font-normal text-muted-foreground">
                        <span className="font-mono">{c.asin}</span>, {c.score.score ?? "n/a"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const isGap = gapIds.has(i.id);
                  return (
                    <tr key={i.id} className="border-b last:border-0">
                      <th
                        scope="row"
                        className={cn(
                          "sticky left-0 z-10 max-w-[260px] bg-background px-4 py-2.5 text-left font-normal",
                          isGap && "shadow-[inset_3px_0_0_var(--primary)]",
                        )}
                      >
                        <span className="line-clamp-2">{i.question}</span>
                        {!estimated && <span className="text-xs text-muted-foreground tabular-nums">{i.frequency} asking</span>}
                        {isGap && <span className="sr-only"> (gap)</span>}
                      </th>
                      <td className="bg-tint/60 px-3 py-2.5">
                        <Cell grade={mine.get(i.id)} quote={mine.get(i.id)?.quotes[0]?.text} />
                      </td>
                      {theirs.map((m, n) => (
                        <td key={comps[n]!.asin} className="px-3 py-2.5">
                          <Cell grade={m.get(i.id)} quote={m.get(i.id)?.quotes[0]?.text} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            Contradicts means two fields on that listing disagree. n/a means the question doesn't apply to that product. Hover a cell to see the
            quote.
          </p>
        </div>
      )}
    </Section>
  );
}
