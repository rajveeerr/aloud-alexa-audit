import { ArrowRightIcon, ExternalLinkIcon, ImageIcon, ImageOffIcon, ScaleIcon, UsersIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { useCountUp } from "@/lib/use-count-up";
import { BAND, basisLabel, competitorCounts, scoreBand, imagesLabel, indexReport, isEstimated, STATUS_LABEL, titleOf, type GradeStatus, type Report, demand } from "@/lib/report";
import { cn, plural } from "@/lib/utils";
import { STATUS_FILL } from "./status";
import { Term } from "./term";

const SOURCE_LABEL = { serpapi: "Live page", dataset: "2023 dataset", paste: "Pasted listing" } as const;

export function ReportHeader({ report }: { report: Report }) {
  const l = report.listing;
  const estimated = isEstimated(report);
  const requestedDiffers = l.asin !== l.requestedAsin;
  const hero = l.images.find((i) => i.kind === "gallery");

  return (
    <header className="flex gap-4 sm:gap-5">
      <ProductImage url={hero?.url} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
          {l.meta.brand && <span className="font-semibold text-foreground">{l.meta.brand}</span>}
          <span className="font-mono text-[12.5px]">{l.asin}</span>
          {requestedDiffers && (
            <span>
              requested <span className="font-mono text-[12.5px]">{l.requestedAsin}</span>
            </span>
          )}
          <span className="rounded-full bg-muted px-2 py-px text-xs font-semibold text-foreground/80">{SOURCE_LABEL[l.source]}</span>
        </p>
        <h1 className="mt-1.5 max-w-[60ch] text-[22px] leading-[1.2] font-bold sm:text-[26px]">{titleOf(report)}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground">
          <span>{report.intentSet.categoryName}</span>
          {estimated ? <Badge variant="warn">Estimated questions</Badge> : <span>{basisLabel(report).replace("Questions", "questions")}</span>}
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
              className="inline-flex items-center gap-1 font-semibold text-primary-ink underline-offset-4 hover:underline"
            >
              View on Amazon <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </p>
        {estimated && (
          <p className="mt-4 max-w-[68ch] rounded-lg border border-[#fcd9a8] bg-tint px-3.5 py-2.5 text-sm text-[#7c2d12]">
            No reviews were mined for this category, so the questions were estimated from this listing and its competitors. Every question
            weighs the same, and the score is a rough guide.
          </p>
        )}
      </div>
    </header>
  );
}

function ProductImage({ url }: { url: string | undefined }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white sm:size-[88px]" aria-hidden="true">
      {url && !failed ? (
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-full object-contain p-1" />
      ) : (
        <ImageOffIcon className="size-5 text-muted-foreground" />
      )}
    </div>
  );
}

/** The verdict: the score, what it's made of, and the few things worth knowing first. */
export function Verdict({ report }: { report: Report }) {
  const items = findings(report);
  return (
    <section aria-label="Verdict" className="grid overflow-hidden rounded-2xl border bg-card shadow-card md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <ScoreBlock report={report} />
      <div className="border-t p-5 sm:p-6 md:border-t-0 md:border-l">
        <h2 className="text-[13px] font-semibold text-muted-foreground">What stands out</h2>
        {items.length === 0 ? (
          <p className="mt-3 text-[15px]">The listing answers every question it's graded on in readable text.</p>
        ) : (
          <ul className="mt-3 grid gap-1">
            {items.map((f) => (
              <li key={f.href}>
                <a href={f.href} className="group -mx-2.5 flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-muted/70">
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", f.tone)} aria-hidden="true">
                    {f.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug font-semibold">{f.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{f.detail}</span>
                  </span>
                  <ArrowRightIcon
                    className="mt-1 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden="true"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type Finding = { href: string; icon: ReactNode; tone: string; title: ReactNode; detail: ReactNode };

/** Up to three plain statements, each one a restatement of numbers already in the report. */
function findings(report: Report): Finding[] {
  const estimated = isEstimated(report);
  const { intents } = indexReport(report);
  const out: Finding[] = [];

  const hidden = report.hiddenAnswers;
  if (hidden.length > 0) {
    const first = hidden[0]!.claims[0];
    out.push({
      href: "#hidden",
      icon: <ImageIcon />,
      tone: "bg-tint-strong text-[#9a3412]",
      title: `${plural(hidden.length, "answer is", "answers are")} only in the images`,
      detail: first ? (
        <>
          “{first.text}” is in {imagesLabel(first.imageIds)}, but not in the text Alexa reads.
        </>
      ) : null,
    });
  }

  const unanswered = [...report.gaps].filter((g) => g.status !== "partial").sort((a, b) => b.frequency - a.frequency)[0];
  if (unanswered) {
    const q = intents.get(unanswered.intentId)?.question ?? unanswered.intentId;
    out.push({
      href: `#q-${unanswered.intentId}`,
      icon: <XIcon />,
      tone: "bg-missing-bg text-missing",
      title: estimated ? "A common question has no answer in the text" : "The most asked gap has no answer in the text",
      detail: (
        <>
          “{q}”{estimated ? "" : `, ${demand(report, unanswered.frequency)}`}.
        </>
      ),
    });
  }

  if (report.competitors.length > 0) {
    const beaten = report.gaps.filter((g) => competitorCounts(report, g.intentId).competitorsAnswering > 0);
    if (beaten.length > 0) {
      out.push({
        href: "#competitors",
        icon: <UsersIcon />,
        tone: "bg-[#efeaf5] text-sd-purple",
        title: `${plural(beaten.length, "gap")} that competitors already answer`,
        detail: `Compared with ${plural(report.competitors.length, "competing listing")} in ${report.intentSet.categoryName}.`,
      });
    }
  }

  const contested = report.proof?.claims.filter((c) => c.verdict === "contested") ?? [];
  if (contested.length > 0) {
    out.push({
      href: "#proof",
      icon: <ScaleIcon />,
      tone: "bg-contradicted-bg text-contradicted",
      title: `${plural(contested.length, "claim")} on the listing ${contested.length === 1 ? "is" : "are"} contested by reviews`,
      detail: <>“{contested[0]!.claim}”, and what reviewers say about it.</>,
    });
  }

  return out.slice(0, 3);
}

const METER_ORDER: GradeStatus[] = ["answered", "partial", "contradicted", "missing"];

function ScoreBlock({ report }: { report: Report }) {
  const s = report.score;
  const estimated = isEstimated(report);
  const shown = useCountUp(s.score);
  const band = scoreBand(s.score);
  const { intents } = indexReport(report);
  const counted = report.grades
    .filter((g) => intents.get(g.intentId)?.kind !== "experience" && g.status !== "not_applicable")
    .map((g) => ({ g, weight: estimated ? 1 : (intents.get(g.intentId)?.frequency ?? 0) }))
    .sort((a, b) => METER_ORDER.indexOf(a.g.status) - METER_ORDER.indexOf(b.g.status) || b.weight - a.weight);
  const total = counted.reduce((n, c) => n + c.weight, 0) || 1;
  const legend = (
    [
      ["answered", s.answered],
      ["partial", s.partial],
      ["contradicted", s.contradicted],
      ["missing", s.missing],
    ] as const
  ).filter(([status, n]) => n > 0 || status === "missing");

  return (
    <section aria-label="Score" className="bg-[#fcfbf9] p-5 sm:p-6">
      <p className="text-[13px] font-semibold text-muted-foreground">Answerability score</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[56px] leading-none font-bold tracking-[-0.03em] tabular-nums" data-testid="score">
          {shown ?? "n/a"}
        </span>
        <span className="text-[15px] text-muted-foreground tabular-nums">
          / 100{estimated && <span className="ml-1 font-semibold text-[#9a3412]">(estimated)</span>}
        </span>
        {band && (
          <Tip content="80 or more is ready, 50 to 79 partly ready, under 50 not ready. A rule of thumb for the listing text, not a prediction of what Alexa will do.">
            <button type="button" className={cn("ml-auto self-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold", BAND[band].tone)} data-testid="score-band">
              {BAND[band].label}
            </button>
          </Tip>
        )}
      </div>
      <p className="mt-2 text-[15px] font-semibold">
        Answers {s.answered} of {plural(s.counted, "question")}
      </p>

      <div className="relative mt-4">
        <ol className="flex h-3 gap-[2px] overflow-hidden rounded-full" aria-label="Each counted question, best answered first">
          {counted.map(({ g, weight }) => (
            <li key={g.intentId} className="min-w-[3px]" style={{ flexGrow: weight, flexBasis: 0 }}>
              <Tip
                content={
                  <>
                    <span className="font-semibold">{STATUS_LABEL[g.status]}</span>: {intents.get(g.intentId)?.question ?? g.intentId}
                    {!estimated && <span className="text-white/70"> ({demand(report, weight, "short")})</span>}
                  </>
                }
              >
                <a href={`#q-${g.intentId}`} className={cn("block h-full transition-opacity hover:opacity-80", STATUS_FILL[g.status])}>
                  <span className="sr-only">
                    {STATUS_LABEL[g.status]}: {intents.get(g.intentId)?.question}
                  </span>
                </a>
              </Tip>
            </li>
          ))}
        </ol>
        {typeof s.score === "number" && (
          <span
            className="pointer-events-none absolute -top-1 -bottom-1 w-[2px] rounded-full bg-foreground"
            style={{ left: `calc(${Math.min(100, Math.max(0, (counted.reduce((n, c) => n + c.weight * (c.g.status === "answered" ? 1 : c.g.status === "partial" ? 0.5 : 0), 0) / total) * 100))}% - 1px)` }}
            aria-hidden="true"
          />
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Questions by status">
        {legend.map(([status, n]) => (
          <li key={status} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[3px]", STATUS_FILL[status])} aria-hidden="true" />
            <span className="font-semibold tabular-nums">{n}</span>
            <span className="text-muted-foreground">{STATUS_LABEL[status].toLowerCase()}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
        {estimated ? (
          "Each block is one question. Every question weighs the same."
        ) : (
          <>
            Each block is one question, as wide as the number of shoppers who ask it. The line marks the{" "}
            <Term help="The share of shopper demand the listing answers in readable text. A partial answer counts as half.">score</Term>.
          </>
        )}{" "}
        {s.notApplicable > 0 && `${plural(s.notApplicable, "question")} ${s.notApplicable === 1 ? "doesn't" : "don't"} apply to this product.`}
      </p>
    </section>
  );
}

