import { ArrowRightIcon, ImageOffIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useCreateAudit } from "@/api/hooks";
import { cn } from "@/lib/utils";

/**
 * One real finding from the hero audit (Ddaowanx gel pens, B0C9W8DD9S), shown on the landing page so
 * the idea lands before anyone types an ASIN. Every number and quote here is from that saved report;
 * the boxes mark where each claim is printed in listing image 8 (shown cropped to its lower 80%).
 */
const HERO = {
  asin: "B0C9W8DD9S",
  image: "https://m.media-amazon.com/images/I/8103G6A1nJL._AC_SL1500_.jpg",
  claims: [
    {
      text: "Smooth Writing",
      box: { left: 3, top: 56.9, width: 33, height: 9.4 },
      asked: 171,
      question: "Does the ink flow consistently without skipping or clogging?",
      inText: "Not answered in the text",
    },
    {
      text: "No Smear: Perfect for Left-Handed",
      box: { left: 3, top: 83.1, width: 43, height: 11.9 },
      asked: 11,
      question: "Does it smudge for left-handed writers?",
      inText: "The text only says “Ambidextrous”",
    },
  ],
};

export function LiveExample({ className }: { className?: string }) {
  const navigate = useNavigate();
  const create = useCreateAudit();
  const [active, setActive] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // The boxes mark spots on the photo, so they only appear once it has loaded.
  const [loaded, setLoaded] = useState(false);

  return (
    <figure className={cn("overflow-hidden rounded-2xl border bg-card shadow-raised", className)} aria-labelledby="example-title">
      <figcaption className="flex items-baseline justify-between gap-3 border-b px-5 py-3.5">
        <span id="example-title" className="text-[15px] font-semibold">
          A hidden answer, from a real audit
        </span>
        <span className="font-mono text-xs text-muted-foreground">{HERO.asin}</span>
      </figcaption>

      <div className="grid sm:grid-cols-[minmax(0,9fr)_minmax(0,11fr)] lg:grid-cols-1">
        <div className="flex flex-col bg-[#faf8f5]">
        <div className={cn("relative aspect-[5/4] overflow-hidden", loaded || failed ? "bg-white" : "animate-pulse bg-muted")}>
          {failed ? (
            <span className="flex size-full flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ImageOffIcon className="size-5" aria-hidden="true" /> Image unavailable
            </span>
          ) : (
            <img
              src={HERO.image}
              alt="Listing image 8 of Ddaowanx gel pens: a hand writing in a notebook, with printed claims in a pink circle"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              onLoad={() => setLoaded(true)}
              className={cn("size-full object-cover object-bottom transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
            />
          )}
          {loaded &&
            HERO.claims.map((c, i) => (
              <span
                key={c.text}
                aria-hidden="true"
                className={cn(
                  "absolute rounded-md ring-2 ring-primary ring-offset-1 ring-offset-white/40 transition-[background-color,box-shadow] duration-200",
                  active === i ? "bg-primary/25 ring-[3px]" : "bg-primary/10",
                )}
                style={{ left: `${c.box.left}%`, top: `${c.box.top}%`, width: `${c.box.width}%`, height: `${c.box.height}%` }}
              >
                <span className="absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-sm">
                  {i + 1}
                </span>
              </span>
            ))}
          <span className="absolute top-2.5 left-2.5 rounded-full bg-[#231f23]/80 px-2 py-0.5 text-[11.5px] font-semibold text-white backdrop-blur-sm">
            Image 8
          </span>
        </div>
          <p className="px-4 py-3 text-[13px] leading-snug text-muted-foreground">
            The brand already says both, but only inside an image, where Alexa may not read them.
          </p>
        </div>

        <div className="flex flex-col border-t sm:border-t-0 sm:border-l lg:border-l-0">
          <ol className="grid flex-1 content-start [&>li:last-child]:border-b-0 sm:[&>li:last-child]:border-b">
            {HERO.claims.map((c, i) => (
              <li
                key={c.text}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={cn("border-b px-4 py-3.5 transition-colors", active === i && "bg-tint")}
              >
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="text-[15px] leading-snug font-semibold">“{c.text}”</span>
                </p>
                <p className="mt-1.5 pl-7 text-[13px] leading-snug text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{c.asked} shoppers</span> ask “{c.question}”
                </p>
                <p className="mt-1 pl-7 text-[13px] leading-snug font-semibold text-missing">{c.inText}</p>
              </li>
            ))}
          </ol>
          <div className="mt-auto p-4">
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate({ asin: HERO.asin, source: "serpapi" }, { onSuccess: (job) => navigate(`/audits/${job.id}`) })}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
            >
              {create.isPending ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : null}
              Open the full report
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </figure>
  );
}
