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
export function StatusIcon({ status, className }: { status: GradeStatus; className?: string }) {
  const { icon: Icon, cls } = STYLE[status];
  return (
    <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full", cls, className)}>
      <Icon className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
      <span className="sr-only">{STATUS_LABEL[status]}</span>
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

export const STATUS_FILL: Record<GradeStatus, string> = {
  answered: "bg-answered",
  partial: "bg-[#f59e0b]",
  missing: "bg-[#fca5a5]",
  contradicted: "bg-contradicted",
  not_applicable: "bg-na-bg",
};
