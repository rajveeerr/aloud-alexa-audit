import { Asin, PublicAuditBody } from "@answerable/contracts";
import type { PublicAuditResult } from "@answerable/contracts";
import { ImageIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useCreatePublicAudit, usePublicAudit } from "@/api/hooks";
import { cn } from "@/lib/utils";

const label = "font-sd-mono text-[11px] tracking-[0.07em] text-[#6d6670]";
const field =
  "h-12 w-full rounded-lg border border-[#dcd8d4] bg-white px-4 text-[15px] text-sd-dark outline-none placeholder:text-[#9a949c] focus-visible:border-sd-dark focus-visible:ring-[3px] focus-visible:ring-sd-orange/40 aria-invalid:border-[#c2410c]";
const cta =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-sd-orange px-6 text-[15px] font-semibold text-sd-dark transition-colors hover:bg-[#ec8f00] focus-visible:ring-[3px] focus-visible:ring-sd-dark/30 focus-visible:outline-none disabled:opacity-60";

const STATUS_WORDS: Record<string, string> = { missing: "Not answered", partial: "Partly answered", contradicted: "Contradicted" };

export function WidgetPage() {
  const [asin, setAsin] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const create = useCreatePublicAudit();
  const result = usePublicAudit(id);
  const ids = { asin: useId(), email: useId(), err: useId() };

  function submit(e: FormEvent) {
    e.preventDefault();
    const a = asin.trim().toUpperCase();
    if (!Asin.safeParse(a).success) return setError("Enter a 10-character ASIN starting with B0.");
    const body = { asin: a, ...(email.trim() && { email: email.trim() }) };
    if (!PublicAuditBody.safeParse(body).success) return setError("That email address doesn't look right.");
    setError(null);
    create.mutate(body, { onSuccess: (r) => setId(r.id) });
  }

  const data = result.data;
  const busy = create.isPending || (!!id && (!data || data.status === "queued" || data.status === "running"));

  return (
    <div className="min-h-dvh bg-sd-light font-sd text-sd-dark">
      <div className="border-b border-sd-depth bg-white/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-[13px] text-[#6d6670]">
          <span>Preview of the widget as it would sit on the salesduo.com homepage</span>
          <Link to="/" className="font-semibold text-sd-purple underline-offset-4 hover:underline">
            Back to the app
          </Link>
        </div>
      </div>

      <main className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:py-20">
        <div>
          <p className={label}>FREE ALEXA READINESS CHECK</p>
          <h1 className="mt-4 text-[38px] leading-[1.05] font-semibold sm:text-[48px]">Can Alexa answer your shoppers' questions?</h1>
          <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[#4a444b]">
            Shoppers now ask Alexa instead of typing keywords. Enter your ASIN to see how much of what they ask your listing answers, and the three
            biggest gaps.
          </p>
        </div>

        <section aria-label="Check a listing" className="rounded-[1.25rem] bg-white p-6 shadow-[0_1px_0_#ececec,0_12px_32px_-12px_rgba(35,31,35,0.18)] sm:p-8">
          <form onSubmit={submit} noValidate className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor={ids.asin} className={label}>
                ASIN
              </label>
              <input
                id={ids.asin}
                value={asin}
                onChange={(e) => setAsin(e.target.value)}
                placeholder="B0C9W8DD9S"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!error && !Asin.safeParse(asin.trim().toUpperCase()).success}
                aria-describedby={error ? ids.err : undefined}
                className={cn(field, "font-sd-mono uppercase placeholder:normal-case")}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor={ids.email} className={label}>
                EMAIL <span className="tracking-normal normal-case">(optional, for the full report)</span>
              </label>
              <input id={ids.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" autoComplete="email" className={field} />
            </div>
            {error && (
              <p id={ids.err} role="alert" className="text-sm text-[#b42318]">
                {error}
              </p>
            )}
            <button type="submit" className={cta} disabled={busy}>
              {busy && <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />}
              {busy ? "Checking your listing" : "Check my listing"}
            </button>
          </form>

          <div aria-live="polite">
            {create.error && <p className="mt-5 text-sm text-[#b42318]">{create.error.message}</p>}
            {result.error && <p className="mt-5 text-sm text-[#b42318]">{result.error.message}</p>}
            {data?.status === "failed" && (
              <p className="mt-5 text-sm text-[#b42318]">We couldn't audit {data.asin}. Check the ASIN is a live US listing and try again.</p>
            )}
            {data?.status === "done" && <Result data={data} email={email} />}
          </div>
        </section>
      </main>
    </div>
  );
}

function Result({ data, email }: { data: PublicAuditResult; email: string }) {
  const estimated = data.scoreBasis === "estimated";
  return (
    <div className="mt-7 border-t border-sd-depth pt-6" data-testid="widget-result">
      <p className={label}>READINESS SCORE</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-[52px] leading-none font-semibold tabular-nums">{data.score ?? "n/a"}</span>
        <span className="text-[15px] text-[#6d6670]">/ 100{estimated && " (estimated)"}</span>
      </p>
      <p className="mt-2 text-sm text-[#4a444b]">
        {estimated ? "There aren't enough reviews in this category yet, so the questions were estimated." : "Weighted by how often shoppers ask each question."}
      </p>

      <p className={cn(label, "mt-6")}>TOP 3 GAPS</p>
      <ol className="mt-3 grid gap-2.5" data-testid="widget-gaps">
        {(data.topGaps ?? []).map((g, i) => (
          <li key={g.question} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 rounded-xl bg-sd-light p-3.5">
            <span className="font-sd-mono text-[13px] text-sd-purple" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <p className="text-[15px] leading-snug font-semibold">{g.question}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#6d6670]">
                <span>{STATUS_WORDS[g.status] ?? g.status}</span>
                {g.competitorShare !== null && <span>{Math.round(g.competitorShare * 100)}% of competitors answer it</span>}
                {g.hiddenInImage && (
                  <span className="inline-flex items-center gap-1 font-semibold text-sd-purple">
                    <ImageIcon className="size-3.5" aria-hidden="true" /> You already say it, but only in an image
                  </span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-xl bg-sd-purple p-5 text-white">
        {data.emailCaptured ? (
          <p className="text-[15px]">
            The full report is on its way to <span className="font-semibold">{email}</span>: every question, the quotes behind each answer, and a fix
            list written from your own listing.
          </p>
        ) : (
          <>
            <p className="text-[17px] font-semibold">Get the full report by email</p>
            <p className="mt-1 text-sm text-white/80">Every question, the quotes behind each answer, and a fix list written from your own listing.</p>
            <button type="button" onClick={() => document.querySelector<HTMLInputElement>("input[type=email]")?.focus()} className={cn(cta, "mt-4 h-11 text-[14px]")}>
              Add my email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
