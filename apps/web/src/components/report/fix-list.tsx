import { ArrowRightIcon, ImageIcon, MessageCircleQuestionIcon, PlusIcon, ShieldAlertIcon, TypeIcon } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { BRIEF_FLAG_TEXT, competitorCounts, countsLabel, fixGains, imagesLabel, isEstimated, placeLabel, targetLabel, type Report, type ReportIndex } from "@/lib/report";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { ActionTag, Gain } from "./top-fixes";

export function FixList({ report, index }: { report: Report; index: ReportIndex }) {
  const estimated = isEstimated(report);
  const gains = fixGains(report);

  return (
    <Section
      id="fixes"
      title="Fix list"
      description="In priority order: how often shoppers ask, how far the listing falls short, and how many competitors answer it. Drafts only use the brand's own words."
    >
      {report.briefs.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">Nothing to fix: the listing answers every question competitors answer.</p>
      ) : (
        <ol className="grid gap-3" data-testid="fix-list">
          {report.briefs.map((b, n) => {
            const gap = report.gaps.find((g) => g.intentId === b.intentId);
            const heldBack = !!b.rejectedStatements?.length;
            const imageSources = b.sources.filter((s) => s.kind === "image");
            const fromImages = [...new Set(imageSources.flatMap((s) => index.claims.get(s.id)?.imageIds ?? []))];
            const flags = b.flags.filter((f) => f !== "unsupported_claim" || !heldBack);
            return (
              <li key={b.intentId} id={`fix-${b.intentId}`} className="scroll-mt-32 rounded-2xl border bg-card p-5 shadow-card sm:p-6" data-testid="fix">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-[13px] font-bold text-background tabular-nums" aria-hidden="true">
                    {n + 1}
                  </span>
                  <ActionTag action={b.action} />
                  <Gain points={gains.get(b.intentId)} />
                  <span className="text-[13px] text-muted-foreground tabular-nums sm:ml-auto">
                    {estimated ? "Estimated question" : `${gap?.frequency.toLocaleString() ?? "?"} shoppers ask`}, {countsLabel(competitorCounts(report, b.intentId))}
                  </span>
                </div>
                <h3 className="mt-3 text-base leading-snug font-semibold">{b.question}</h3>

                <div className="mt-3 overflow-hidden rounded-xl border">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-[#fcfbf9] px-3.5 py-2 text-[13px] text-muted-foreground">
                    {fromImages.length > 0 && b.action === "move_from_image" && (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <ImageIcon className="size-3.5" aria-hidden="true" />
                          From {imagesLabel(fromImages)}
                        </span>
                        <ArrowRightIcon className="size-3.5" aria-label="into" />
                      </>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <TypeIcon className="size-3.5" aria-hidden="true" />
                      Target: <span className="font-semibold text-foreground">{targetLabel(b.target)}</span>
                      {b.target !== "new_bullet" && <span className="font-mono text-xs">({b.target})</span>}
                    </span>
                  </p>

                  {b.draft && (
                    <div className="flex items-start gap-3 bg-answered-bg/50 px-3.5 py-3">
                      <PlusIcon className="mt-1 size-4 shrink-0 text-answered" strokeWidth={2.75} aria-label="Add" />
                      <p className="min-w-0 flex-1 text-[15px] leading-relaxed font-semibold text-[#14301f]" data-testid="draft">
                        {b.draft}
                      </p>
                      <CopyButton text={b.draft} />
                    </div>
                  )}

                  {b.needsFromBrand && (
                    <div className={cn("flex items-start gap-3 bg-[#f6f3fa] px-3.5 py-3 text-sm", b.draft && "border-t")}>
                      <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0 text-sd-purple" aria-hidden="true" />
                      <p>
                        <span className="font-semibold text-sd-purple">Needs from the brand: </span>
                        {b.needsFromBrand}
                      </p>
                    </div>
                  )}
                </div>

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
                  <div className="mt-3.5">
                    <p className="text-xs font-semibold text-muted-foreground">Built from the brand's own words</p>
                    <ul className="mt-1.5 grid gap-1.5">
                      {b.sources.map((s) => {
                        const imgs = s.kind === "image" ? (index.claims.get(s.id)?.imageIds ?? []) : [];
                        return (
                          <li key={`${s.kind}:${s.id}:${s.text}`} className="flex items-center gap-2.5 text-[13px]">
                            {s.kind === "image" && imgs[0] && index.images.get(imgs[0]) ? (
                              <img
                                src={index.images.get(imgs[0])!.url}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="size-7 shrink-0 rounded-md border bg-white object-cover"
                              />
                            ) : (
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/60 text-muted-foreground" aria-hidden="true">
                                <TypeIcon className="size-3.5" />
                              </span>
                            )}
                            <span className="min-w-0">
                              “{s.text}”{" "}
                              <span className="text-muted-foreground" title={s.kind === "image" ? imgs.join(", ") || s.id : s.id}>
                                {s.kind === "image" ? `text in ${imagesLabel(imgs) || s.id}` : placeLabel(s.id)}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {flags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {flags.map((f) => (
                      <Tip key={f} content={BRIEF_FLAG_TEXT[f]}>
                        <button type="button" className="rounded-full">
                          <Badge variant="outline">{f.replace(/_/g, " ")}</Badge>
                          <span className="sr-only">: {BRIEF_FLAG_TEXT[f]}</span>
                        </button>
                      </Tip>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
