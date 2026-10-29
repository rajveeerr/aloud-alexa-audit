import { isEstimated, fieldLabel, targetLabel, type Report, type ReportIndex } from "@/lib/report";
import { plural } from "@/lib/utils";
import { ImageThumb } from "./image-thumb";
import { Section } from "./section";

export function HiddenAnswers({ report, index }: { report: Report; index: ReportIndex }) {
  const estimated = isEstimated(report);
  const imageOnly = report.coverage.filter((m) => m.coverage === "image_only").length;
  const read = report.imageClaims.length > 0;

  const description = read
    ? `Answers the brand already gives, but only inside images, where Alexa may not read them. Found ${plural(report.imageClaims.length, "claim")} across ${plural(report.listing.images.length, "image")}; ${imageOnly} appear only in images.`
    : "Answers the brand gives only inside images.";

  return (
    <Section id="hidden" title="Hidden answers" description={description}>
      {!read ? (
        <p className="text-[15px] text-muted-foreground">The images weren't read for this audit, so hidden answers weren't checked.</p>
      ) : report.hiddenAnswers.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">
          None. Every image claim that answers a shopper question is also in the listing's text.
        </p>
      ) : (
        <ul className="grid gap-4">
          {report.hiddenAnswers.map((h) => {
            const intent = index.intents.get(h.intentId);
            const textGrade = report.grades.find((g) => g.intentId === h.intentId);
            const brief = report.briefs.find((b) => b.intentId === h.intentId && b.action === "move_from_image");
            const imageIds = [...new Set(h.claims.flatMap((c) => c.imageIds))];
            return (
              <li key={h.intentId} className="grid grid-cols-[minmax(0,1fr)] gap-5 rounded-xl bg-tint p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="hidden-answer">
                <div className="min-w-0">
                  <p className="text-sm text-[#7c2d12]">
                    {intent?.question}
                    {!estimated && intent && (
                      <span className="ml-1.5 font-semibold whitespace-nowrap">{intent.frequency.toLocaleString()} shoppers ask</span>
                    )}
                  </p>
                  <ul className="mt-3 grid gap-2">
                    {h.claims.map((c) => (
                      <li key={c.id}>
                        <q className="text-[22px] leading-snug font-bold tracking-[-0.01em] [quotes:'“'_'”']">{c.text}</q>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          in <span className="font-mono">{c.imageIds.join(", ")}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-4 grid gap-1.5 text-sm">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">In the text:</dt>
                      <dd>
                        {h.textStatus === "missing" ? (
                          "not answered anywhere"
                        ) : (
                          <>
                            only partly
                            {textGrade?.quotes.map((q) => (
                              <span key={q.fieldId + q.text}>
                                , “{q.text}” <span className="text-muted-foreground">({fieldLabel(q.fieldId)})</span>
                              </span>
                            ))}
                          </>
                        )}
                      </dd>
                    </div>
                    {brief && (
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">Fix:</dt>
                        <dd>
                          move it into <span className="font-semibold">{targetLabel(brief.target).toLowerCase()}</span>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
                <div className="flex flex-wrap content-start items-start gap-3">
                  {imageIds.slice(0, 4).map((id) => {
                    const img = index.images.get(id);
                    const isWide = img?.kind === "aplus";
                    return (
                      <ImageThumb
                        key={id}
                        image={img}
                        alt={`Listing image ${id}, which shows: ${h.claims.filter((c) => c.imageIds.includes(id)).map((c) => c.text).join("; ")}`}
                        className={isWide ? "w-[300px] max-w-full" : "w-[132px]"}
                      />
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
