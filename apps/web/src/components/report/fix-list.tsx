import { ShieldAlertIcon } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { ACTION_LABEL, BRIEF_FLAG_TEXT, fieldLabel, isEstimated, shareLabel, targetLabel, type Brief, type Report, type ReportIndex } from "@/lib/report";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { SendToStudio } from "./send-to-studio";

const ACTION_TONE: Record<Brief["action"], string> = {
  move_from_image: "bg-primary/20 text-[#7c2d12]",
  fix_contradiction: "bg-contradicted-bg text-contradicted",
  edit_field: "bg-muted text-foreground",
  add_bullet: "bg-muted text-foreground",
  request_fact: "bg-[#efeaf5] text-[#4c3e5e]",
};

export function FixList({ report, index, auditId }: { report: Report; index: ReportIndex; auditId: string }) {
  const estimated = isEstimated(report);
  const total = report.competitors.length;

  return (
    <Section
      id="fixes"
      title="Fix list"
      description="In priority order: how often shoppers ask, how far the listing falls short, and how many competitors answer it. Drafts only use the brand's own words."
      aside={<SendToStudio auditId={auditId} disabled={report.briefs.length === 0} />}
    >
      {report.briefs.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">Nothing to fix: the listing answers every question competitors answer.</p>
      ) : (
        <ol className="grid gap-3" data-testid="fix-list">
          {report.briefs.map((b, n) => {
            const gap = report.gaps.find((g) => g.intentId === b.intentId);
            const heldBack = !!b.rejectedStatements?.length;
            return (
              <li key={b.intentId} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 rounded-xl border p-4 sm:p-5" data-testid="fix">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[13px] font-bold tabular-nums" aria-hidden="true">
                  {n + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", ACTION_TONE[b.action])}>{ACTION_LABEL[b.action]}</span>
                    <span className="text-[13px] text-muted-foreground">
                      Target: <span className="font-semibold text-foreground">{targetLabel(b.target)}</span>
                      {b.target !== "new_bullet" && <span className="ml-1 font-mono text-xs">({b.target})</span>}
                    </span>
                  </div>
                  <h3 className="mt-2 text-[15px] font-semibold">{b.question}</h3>
                  <p className="text-[13px] text-muted-foreground">
                    {estimated ? "Estimated question" : `${gap?.frequency.toLocaleString() ?? "?"} shoppers ask`}, {shareLabel(gap?.competitorShare ?? null, total)}
                  </p>

                  {b.draft && (
                    <div className="mt-3 rounded-lg bg-muted/70 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[15px] leading-relaxed font-semibold" data-testid="draft">
                          {b.draft}
                        </p>
                        <CopyButton text={b.draft} />
                      </div>
                    </div>
                  )}

                  {b.needsFromBrand && (
                    <p className="mt-3 rounded-lg border border-dashed border-[#cbbfda] bg-[#f8f6fb] px-4 py-3 text-sm">
                      <span className="font-semibold text-[#4c3e5e]">Needs from the brand: </span>
                      {b.needsFromBrand}
                    </p>
                  )}

                  {heldBack && (
                    <div className="mt-3 flex gap-2 text-sm">
                      <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-contradicted" aria-hidden="true" />
                      <p>
                        <span className="font-semibold">Held back: added claims the brand never made.</span>{" "}
                        <span className="text-muted-foreground">
                          {b.rejectedStatements!.map((s, i) => (
                            <span key={s}>
                              {i > 0 && ", "}
                              <s>“{s}”</s>
                            </span>
                          ))}
                        </span>
                      </p>
                    </div>
                  )}

                  {b.sources.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-muted-foreground">Built from</p>
                      <ul className="mt-1 grid gap-1">
                        {b.sources.map((s) => {
                          const imgs = s.kind === "image" ? (index.claims.get(s.id)?.imageIds ?? []) : [];
                          return (
                            <li key={s.kind + s.id} className="text-[13px]">
                              “{s.text}”{" "}
                              <span className="text-muted-foreground">
                                {s.kind === "image" ? (
                                  <>
                                    image text in <span className="font-mono">{imgs.join(", ") || s.id}</span>
                                  </>
                                ) : (
                                  <>
                                    {fieldLabel(s.id)} <span className="font-mono">({s.id})</span>
                                  </>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {b.flags.filter((f) => f !== "unsupported_claim" || !heldBack).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {b.flags
                        .filter((f) => f !== "unsupported_claim" || !heldBack)
                        .map((f) => (
                          <Tip key={f} content={BRIEF_FLAG_TEXT[f]}>
                            <button type="button" className="rounded-full">
                              <Badge variant="outline">{f.replace(/_/g, " ")}</Badge>
                              <span className="sr-only">: {BRIEF_FLAG_TEXT[f]}</span>
                            </button>
                          </Tip>
                        ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
