import { CheckIcon, CircleDashedIcon, MinusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { STATUS_LABEL, type GradeStatus } from "@/lib/report";
import { cn } from "@/lib/utils";

const STYLE: Record<GradeStatus, { icon: typeof CheckIcon; cls: string }> = {
  answered: { icon: CheckIcon, cls: "bg-answered-bg text-answered" },
  partial: { icon: CircleDashedIcon, cls: "bg-partial-bg text-partial" },
  missing: { icon: XIcon, cls: "bg-missing-bg text-missing" },
  contradicted: { icon: TriangleAlertIcon, cls: "bg-contradicted text-white" },
  not_applicable: { icon: MinusIcon, cls: "bg-na-bg text-na" },
};

/** Status as an icon in a tinted circle, with the status name for screen readers. */
export function StatusIcon({ status, className, label = true }: { status: GradeStatus; className?: string; label?: boolean }) {
  const { icon: Icon, cls } = STYLE[status];
  return (
    <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full", cls, className)}>
      <Icon className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
      {label && <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  );
}

export const STATUS_TEXT_CLASS: Record<GradeStatus, string> = {
  answered: "text-answered",
  partial: "text-partial",
  missing: "text-missing",
  contradicted: "text-contradicted",
  not_applicable: "text-na",
};

/** One fill per status, shared by the score meter, its legend and every bar. */
export const STATUS_FILL: Record<GradeStatus, string> = {
  answered: "bg-answered-fill",
  partial: "bg-partial-fill",
  missing: "bg-missing-fill",
  contradicted: "bg-contradicted-fill",
  not_applicable: "bg-na-fill",
};

/** One sentence per status, for the legend's tooltips. */
export const STATUS_HELP: Record<GradeStatus, string> = {
  answered: "The listing's text answers it, with a quote that code found on the page.",
  partial: "The text answers part of the question. It counts as half in the score.",
  missing: "Nothing in the readable text answers it.",
  contradicted: "Two places on the listing disagree, so it counts as unanswered.",
  not_applicable: "The question doesn't apply to this product and isn't scored.",
};

/** A compact key: icon, name, and a one-line definition on hover or focus. */
export function StatusLegend({ statuses, className }: { statuses: GradeStatus[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground", className)} aria-label="Status key">
      {statuses.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <StatusIcon status={s} label={false} className="size-[18px] [&_svg]:size-2.5" />
          {STATUS_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}
