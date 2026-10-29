import { ImageIcon, InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { GRADE_FLAG_TEXT, isEstimated, sortGrades, STATUS_LABEL, type Grade, type Report, type ReportIndex } from "@/lib/report";
import { cn } from "@/lib/utils";
import { StatusIcon, STATUS_TEXT_CLASS } from "./status";

const FLAG_LABEL: Record<Grade["flags"][number], string> = {
  quote_not_found: "Quote dropped",
  quote_field_corrected: "Field corrected",
  unverified_answer: "Unverified answer",
  unverified_contradiction: "Unverified contradiction",
  not_applicable_rejected: "Graded anyway",
  conditional_unaddressed: "Left out",
  not_graded: "Not graded",
};

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
  const estimated = isEstimated(report);
  const hidden = new Set(report.hiddenAnswers.map((h) => h.intentId));
  const scored = sortGrades(
    report.grades.filter((g) => index.intents.get(g.intentId)?.kind !== "experience"),
    index.intents,
  );
  const experience = report.intentSet.intents.filter((i) => i.kind === "experience").sort((a, b) => b.frequency - a.frequency);

  return (
    <div>
      <ul className="divide-y rounded-xl border" aria-label="Scored questions">
        {scored.map((g) => {
          const intent = index.intents.get(g.intentId);
          const isSelected = selected === g.intentId;
          return (
            <li
              key={g.intentId}
              id={`q-${g.intentId}`}
              className={cn("relative scroll-mt-32 px-4 py-3.5 transition-colors", isSelected ? "bg-tint" : "hover:bg-muted/60")}
            >
              <div className="flex gap-3">
                <StatusIcon status={g.status} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(g.intentId)}
                      className="text-left text-[15px] font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                    >
                      {intent?.question ?? g.intentId}
                    </button>
                    <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                      {estimated ? "estimated" : `${intent?.frequency.toLocaleString()} asking`}
                    </span>
                  </div>
                  <p className={cn("mt-0.5 text-[13px] font-semibold", STATUS_TEXT_CLASS[g.status])}>
                    {STATUS_LABEL[g.status]}
                  </p>
                  {g.quotes.length > 0 && (
                    <ul className="mt-2 grid gap-1">
                      {g.quotes.map((q) => (
                        <li key={q.fieldId + q.text} className="text-sm">
                          <span className="rounded-[3px] bg-primary/20 px-1 py-px">“{q.text}”</span>{" "}
                          <span className="font-mono text-[12px] text-muted-foreground">{q.fieldId}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(g.flags.length > 0 || hidden.has(g.intentId) || g.modelStatus !== g.status) && (
                    <div className="relative z-10 mt-2 flex flex-wrap gap-1.5">
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
                        <span className="text-xs text-muted-foreground">
                          The grader first said {STATUS_LABEL[g.modelStatus].toLowerCase()}.
                        </span>
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
              <li key={i.id} className="rounded-full border px-3 py-1 text-[13px]">
                {i.question}
                {!estimated && <span className="ml-1.5 text-muted-foreground tabular-nums">{i.frequency}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
