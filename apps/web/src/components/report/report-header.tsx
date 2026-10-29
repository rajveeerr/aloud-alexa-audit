import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { basisLabel, indexReport, isEstimated, sortGrades, STATUS_LABEL, titleOf, type Report } from "@/lib/report";
import { cn, plural } from "@/lib/utils";
import { STATUS_FILL } from "./status";

const SOURCE_LABEL = { serpapi: "Live page", dataset: "2023 dataset", paste: "Pasted listing" } as const;

export function ReportHeader({ report }: { report: Report }) {
  const l = report.listing;
  const estimated = isEstimated(report);
  const requestedDiffers = l.asin !== l.requestedAsin;

  return (
    <header className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {l.meta.brand && <span className="font-semibold text-foreground">{l.meta.brand}</span>}
          <span className="font-mono text-[13px]">{l.asin}</span>
          {requestedDiffers && <span>requested {<span className="font-mono text-[13px]">{l.requestedAsin}</span>}</span>}
          <span>{SOURCE_LABEL[l.source]}</span>
        </p>
        <h1 className="mt-2 max-w-[60ch] text-2xl leading-tight font-bold sm:text-[28px]">{titleOf(report)}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{report.intentSet.categoryName}</span>
          {estimated ? (
            <Badge variant="warn">Estimated questions</Badge>
          ) : (
            <span>{basisLabel(report).replace("Questions", "questions")}</span>
          )}
          {!report.intentSet.reviewed && (
            <Tip content="A person hasn't checked these questions, their kinds or their rubrics yet.">
              <button type="button" className="rounded-full">
                <Badge variant="outline">Not yet reviewed by hand</Badge>
              </button>
            </Tip>
          )}
          {l.source !== "paste" && (
            <a
              href={`https://www.amazon.com/dp/${l.asin}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-primary-ink hover:underline"
            >
              View on Amazon <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </p>
        {estimated && (
          <p className="mt-4 max-w-[68ch] rounded-md border border-[#fcd9a8] bg-tint px-3 py-2 text-sm text-[#7c2d12]">
            No reviews were mined for this category, so the questions were estimated from this listing and its competitors. Every question
            weighs the same, and the score is a rough guide.
          </p>
        )}
      </div>
      <ScoreBlock report={report} />
    </header>
  );
}

function ScoreBlock({ report }: { report: Report }) {
  const s = report.score;
  const estimated = isEstimated(report);
  const { intents } = indexReport(report);
  const counted = sortGrades(
    report.grades.filter((g) => intents.get(g.intentId)?.kind !== "experience" && g.status !== "not_applicable"),
    intents,
  ).reverse();

  return (
    <section aria-label="Score" className="rounded-xl border p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[56px] leading-none font-bold tabular-nums" data-testid="score">
          {s.score ?? "n/a"}
        </span>
        <span className="text-sm text-muted-foreground">/ 100{estimated && <span className="ml-1 font-semibold text-[#9a3412]">(estimated)</span>}</span>
      </div>
      <p className="mt-2 text-[15px] font-semibold">
        Answers {s.answered} of {plural(s.counted, "question")}
      </p>
      <p className="text-sm text-muted-foreground">
        {s.partial} partly, {s.missing} not at all, {s.contradicted} contradicted
      </p>
      <ol className="mt-4 flex gap-[3px]" aria-label="Each counted question, best answered first">
        {counted.map((g) => (
          <li key={g.intentId} className="min-w-0 flex-1">
            <Tip content={`${STATUS_LABEL[g.status]}: ${intents.get(g.intentId)?.question ?? g.intentId}`}>
              <a href={`#q-${g.intentId}`} className={cn("block h-6 rounded-[3px]", STATUS_FILL[g.status])}>
                <span className="sr-only">
                  {STATUS_LABEL[g.status]}: {intents.get(g.intentId)?.question}
                </span>
              </a>
            </Tip>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {estimated ? "Each question weighs the same." : "Weighted by how often shoppers ask."} {s.notApplicable > 0 && `${plural(s.notApplicable, "question")} ${s.notApplicable === 1 ? "doesn't" : "don't"} apply to this product.`}
      </p>
    </section>
  );
}
