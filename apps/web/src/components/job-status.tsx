import type { AuditStatus } from "@aloud/contracts";
import { LoaderCircleIcon } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

const MAP: Record<AuditStatus, { label: string; variant: BadgeVariant }> = {
  queued: { label: "Queued", variant: "outline" },
  running: { label: "Running", variant: "warn" },
  done: { label: "Done", variant: "answered" },
  failed: { label: "Failed", variant: "missing" },
};

export function JobStatus({ status }: { status: AuditStatus }) {
  const m = MAP[status];
  return (
    <Badge variant={m.variant}>
      {status === "running" && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
      {m.label}
    </Badge>
  );
}

/** A score with a tint that says roughly how it reads, never the number alone in color. */
export function ScoreCell({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground">n/a</span>;
  const tone = score >= 75 ? "bg-answered" : score >= 55 ? "bg-[#f59e0b]" : "bg-[#ef4444]";
  return (
    <span className="inline-flex items-center gap-2 font-semibold tabular-nums">
      <span className={`size-2 rounded-full ${tone}`} aria-hidden="true" />
      {score}
    </span>
  );
}
