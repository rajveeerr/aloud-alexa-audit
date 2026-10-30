import { ImageIcon, InfoIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { GRADE_FLAG_TEXT, isEstimated, placeLabel, sortGrades, STATUS_LABEL, type Grade, type GradeStatus, type Report, type ReportIndex } from "@/lib/report";
import { cn } from "@/lib/utils";
import { StatusIcon, StatusLegend, STATUS_FILL, STATUS_TEXT_CLASS } from "./status";

const FLAG_LABEL: Record<Grade["flags"][number], string> = {
  quote_not_found: "Quote dropped",
  quote_field_corrected: "Field corrected",
  unverified_answer: "Unverified answer",
  unverified_contradiction: "Unverified contradiction",
  not_applicable_rejected: "Graded anyway",
  conditional_unaddressed: "Left out",
  not_graded: "Not graded",
};

type Filter = "all" | "open" | "answered";
const OPEN: GradeStatus[] = ["missing", "partial", "contradicted"];

export function QuestionList({
  report,
  index,
  selected,
  onSelect,
}: {
  report: Report;
  index: ReportIndex;
  selected: string | null;
  onSelect: (intentId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const estimated = isEstimated(report);
  const hidden = new Set(report.hiddenAnswers.map((h) => h.intentId));
  const scored = sortGrades(
    report.grades.filter((g) => index.intents.get(g.intentId)?.kind !== "experience"),
    index.intents,
  );
  const experience = report.intentSet.intents.filter((i) => i.kind === "experience").sort((a, b) => b.frequency - a.frequency);
  const maxFreq = Math.max(1, ...scored.map((g) => index.intents.get(g.intentId)?.frequency ?? 0));
  const present = (["contradicted", "missing", "partial", "answered", "not_applicable"] as GradeStatus[]).filter((s) => scored.some((g) => g.status === s));

  const counts = {
    all: scored.length,
    open: scored.filter((g) => OPEN.includes(g.status)).length,
    answered: scored.filter((g) => g.status === "answered").length,
  };
  const shown = scored.filter((g) => filter === "all" || (filter === "open" ? OPEN.includes(g.status) : g.status === "answered"));
  const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: "Not fully answered" },
    { value: "answered", label: "Answered" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Show questions" className="inline-flex rounded-lg bg-muted p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgba(35,31,35,0.12)]"
            >
              {f.label}
              <span className="text-xs font-normal tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <StatusLegend statuses={present} />
      </div>

      <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card" aria-label="Scored questions">
        {shown.map((g) => {
          const intent = index.intents.get(g.intentId);
          const isSelected = selected === g.intentId;
          const freq = intent?.frequency ?? 0;
          return (
            <li
              key={g.intentId}
              id={`q-${g.intentId}`}
              className={cn(
                "relative scroll-mt-32 px-4 py-3.5 transition-colors sm:px-5",
                isSelected ? "bg-tint" : "hover:bg-muted/50",
              )}
            >
              <div className="flex gap-3">
                <StatusIcon status={g.status} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-x-4">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(g.intentId)}
                      className="text-left text-[15px] leading-snug font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                    >
                      {intent?.question ?? g.intentId}
                    </button>
                    <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                      <span className="text-[13px] text-muted-foreground tabular-nums">{estimated ? "estimated" : `${freq.toLocaleString()} asking`}</span>
                      {!estimated && (
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className={cn("block h-full rounded-full", STATUS_FILL[g.status])} style={{ width: `${Math.max(4, (freq / maxFreq) * 100)}%` }} />
                        </span>
                      )}
                    </span>
                  </div>
                  <p className={cn("mt-0.5 text-[13px] font-semibold", STATUS_TEXT_CLASS[g.status])}>{STATUS_LABEL[g.status]}</p>
                  {g.quotes.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {g.quotes.map((q) => (
                        <li key={q.fieldId + q.text} className="inline-flex max-w-full items-baseline gap-1.5 rounded-md bg-muted/80 px-2 py-1 text-[13px] leading-snug">
                          <span className="min-w-0 rounded-[3px] bg-primary/20 px-1">“{q.text}”</span>
                          <span className="shrink-0 text-xs text-muted-foreground" title={q.fieldId}>
                            {placeLabel(q.fieldId)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(g.flags.length > 0 || hidden.has(g.intentId) || g.modelStatus !== g.status) && (
                    <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1.5">
                      {hidden.has(g.intentId) && (
                        <a href="#hidden" className="rounded-full">
                          <Badge variant="warn">
                            <ImageIcon aria-hidden="true" /> Answered only in an image
                          </Badge>
                        </a>
                      )}
                      {g.flags.map((f) => (
                        <Tip key={f} content={GRADE_FLAG_TEXT[f]}>
                          <button type="button" className="rounded-full" aria-label={`${FLAG_LABEL[f]}: ${GRADE_FLAG_TEXT[f]}`}>
                            <Badge variant="outline">
                              <InfoIcon aria-hidden="true" /> {FLAG_LABEL[f]}
                            </Badge>
                          </button>
                        </Tip>
                      ))}
                      {g.modelStatus !== g.status && !g.flags.includes("conditional_unaddressed") && (
                        <span className="text-xs text-muted-foreground">The grader first said {STATUS_LABEL[g.modelStatus].toLowerCase()}.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {experience.length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-semibold">Only buyers can answer these</h3>
          <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">
            How a product feels or performs in use. A listing saying it doesn't settle it, so these never count toward the score.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {experience.map((i) => (
              <li key={i.id} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[13px]">
                {i.question}
                {!estimated && <span className="text-muted-foreground tabular-nums">{i.frequency}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
