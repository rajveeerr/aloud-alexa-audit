import { ArrowDownIcon, ImageUpIcon, ListPlusIcon, MessageCircleQuestionIcon, PencilLineIcon, TriangleAlertIcon } from "lucide-react";
import { ACTION_LABEL, competitorCounts, countsLabel, fixGains, isEstimated, type Brief, type Report } from "@/lib/report";
import { cn } from "@/lib/utils";

export const ACTION_ICON: Record<Brief["action"], typeof ImageUpIcon> = {
  move_from_image: ImageUpIcon,
  fix_contradiction: TriangleAlertIcon,
  edit_field: PencilLineIcon,
  add_bullet: ListPlusIcon,
  request_fact: MessageCircleQuestionIcon,
};

export const ACTION_TONE: Record<Brief["action"], string> = {
  move_from_image: "bg-tint-strong text-[#9a3412]",
  fix_contradiction: "bg-contradicted-bg text-contradicted",
  edit_field: "bg-muted text-foreground",
  add_bullet: "bg-muted text-foreground",
  request_fact: "bg-[#efeaf5] text-sd-purple",
};

export function ActionTag({ action, className }: { action: Brief["action"]; className?: string }) {
  const Icon = ACTION_ICON[action];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", ACTION_TONE[action], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {ACTION_LABEL[action]}
    </span>
  );
}

/** The first three fixes, right under the verdict, so the report opens on what to do. */
export function TopFixes({ report }: { report: Report }) {
  const top = report.briefs.slice(0, 3);
  if (top.length === 0) return null;
  const estimated = isEstimated(report);
  const gains = fixGains(report);

  return (
    <section aria-labelledby="top-fixes-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="top-fixes-title" className="text-lg font-bold">
          Fix these first
        </h2>
        <a href="#fixes" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-ink underline-offset-4 hover:underline">
          All {report.briefs.length} fixes, with the text to paste <ArrowDownIcon className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <ol className="mt-3 grid overflow-hidden rounded-2xl border bg-card shadow-card md:grid-cols-3" data-testid="top-fixes">
        {top.map((b, n) => {
          const gap = report.gaps.find((g) => g.intentId === b.intentId);
          return (
            <li key={b.intentId} className="border-t first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0">
              <a href={`#fix-${b.intentId}`} className="flex h-full flex-col gap-2.5 p-5 transition-colors hover:bg-muted/50">
                <span className="flex items-center gap-2.5">
                  <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background tabular-nums" aria-hidden="true">
                    {n + 1}
                  </span>
                  <ActionTag action={b.action} />
                  <Gain points={gains.get(b.intentId)} className="ml-auto" />
                </span>
                <span className="text-[15px] leading-snug font-semibold">{b.question}</span>
                {b.draft ? (
                  <span className="block rounded-md bg-answered-bg/70 px-2.5 py-1.5 text-[13px] leading-snug text-[#14532d]">
                    {/* The clamp sits inside the padding, so a third line can't show through it. */}
                    <span className="line-clamp-2">
                      <span className="font-mono text-answered" aria-hidden="true">
                        +{" "}
                      </span>
                      {b.draft}
                    </span>
                  </span>
                ) : b.needsFromBrand ? (
                  <span className="line-clamp-2 text-[13px] leading-snug text-sd-purple">Needs a fact from the brand first.</span>
                ) : null}
                <span className="mt-auto pt-1 text-[13px] text-muted-foreground tabular-nums">
                  {estimated ? "Estimated question" : `${gap?.frequency.toLocaleString() ?? "?"} shoppers ask`} · {countsLabel(competitorCounts(report, b.intentId))}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** What the score would gain once this question is fully answered. */
export function Gain({ points, className }: { points: number | undefined; className?: string }) {
  if (!points) return null;
  return (
    <span className={cn("text-[13px] font-bold text-answered tabular-nums", className)} title="Score gain once this question is fully answered">
      +{points} {points === 1 ? "point" : "points"}
    </span>
  );
}
