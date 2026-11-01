import { PlusIcon, TypeIcon } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { imagesLabel, isEstimated, placeLabel, targetLabel, type Report, type ReportIndex, demand } from "@/lib/report";
import { ImageThumb } from "./image-thumb";
import { Section } from "./section";

export function HiddenAnswers({ report, index }: { report: Report; index: ReportIndex }) {
  const estimated = isEstimated(report);
  const read = report.imageClaims.length > 0;

  return (
    <Section id="hidden" title="Hidden answers">
      {!read ? (
        <p className="text-[15px] text-muted-foreground">The images weren't read for this audit, so hidden answers weren't checked.</p>
      ) : report.hiddenAnswers.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">None. Every image claim that answers a shopper question is also in the listing's text.</p>
      ) : (
        <ul className="grid gap-4">
          {report.hiddenAnswers.map((h) => {
            const intent = index.intents.get(h.intentId);
            const textGrade = report.grades.find((g) => g.intentId === h.intentId);
            const brief = report.briefs.find((b) => b.intentId === h.intentId && b.action === "move_from_image");
            const imageIds = [...new Set(h.claims.flatMap((c) => c.imageIds))];
            const [mainId, ...restIds] = imageIds;
            const claimsIn = (id: string) => h.claims.filter((c) => c.imageIds.includes(id)).map((c) => c.text).join("; ");
            const paste = brief?.draft ?? h.claims[0]?.text;
            return (
              <li
                key={h.intentId}
                className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card shadow-card md:grid-cols-[240px_minmax(0,1fr)]"
                data-testid="hidden-answer"
              >
                <div className="flex gap-3 border-b bg-[#faf8f5] p-4 sm:p-5 md:flex-col md:border-r md:border-b-0">
                  <ImageThumb
                    image={index.images.get(mainId!)}
                    alt={`Listing image ${mainId}, which shows: ${claimsIn(mainId!)}`}
                    className="w-[132px] shrink-0 sm:w-[160px] md:w-full"
                  />
                  {restIds.length > 0 && (
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground md:sr-only">Also in</p>
                      <div className="mt-1.5 flex flex-wrap gap-2 md:mt-0">
                        {restIds.slice(0, 3).map((id) => (
                          <ImageThumb
                            key={id}
                            image={index.images.get(id)}
                            alt={`Listing image ${id}, which shows: ${claimsIn(id)}`}
                            className={index.images.get(id)?.kind === "aplus" ? "w-[132px]" : "w-[56px]"}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 p-5 sm:p-6">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <span>{intent?.question}</span>
                    {!estimated && intent && (
                      <span className="rounded-full bg-tint-strong px-2 py-px text-xs font-semibold whitespace-nowrap text-[#9a3412] tabular-nums">
                        {demand(report, intent.frequency)}
                      </span>
                    )}
                  </p>
                  <ul className="mt-3 grid gap-2.5">
                    {h.claims.map((c) => (
                      <li key={c.id}>
                        <q className="text-[21px] leading-snug font-bold tracking-[-0.015em] [quotes:'“'_'”']">{c.text}</q>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground" title={c.imageIds.join(", ")}>
                          In {imagesLabel(c.imageIds)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-5 grid overflow-hidden rounded-xl border text-sm">
                    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 bg-missing-bg/50 px-3 py-2.5">
                      <dt className="flex size-6 items-center justify-center rounded-md bg-background text-missing" title="In the text now">
                        <TypeIcon className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">In the text now</span>
                      </dt>
                      <dd className="self-center">
                        <span className="font-semibold">In the text now: </span>
                        {h.textStatus === "missing" ? (
                          <span className="text-muted-foreground">not answered anywhere</span>
                        ) : (
                          <span className="text-muted-foreground">
                            only partly
                            {textGrade?.quotes.map((q) => (
                              <span key={q.fieldId + q.text}>
                                , <span className="text-foreground">“{q.text}”</span> <span title={q.fieldId}>({placeLabel(q.fieldId)})</span>
                              </span>
                            ))}
                          </span>
                        )}
                      </dd>
                    </div>
                    {brief && paste && (
                      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 border-t bg-answered-bg/60 px-3 py-2">
                        <dt className="flex size-6 items-center justify-center rounded-md bg-background text-answered" title="The fix">
                          <PlusIcon className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
                          <span className="sr-only">The fix</span>
                        </dt>
                        <dd className="min-w-0">
                          <span className="font-semibold">Move into {targetLabel(brief.target).toLowerCase()}: </span>
                          <span className="text-[#14532d]">“{paste}”</span>
                        </dd>
                        <dd>
                          <CopyButton text={paste} />
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
