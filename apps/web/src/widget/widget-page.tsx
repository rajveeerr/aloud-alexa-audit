import { Asin, PublicAuditBody, PublicEmailBody } from "@aloud/contracts";
import type { PublicAuditResult } from "@aloud/contracts";
import { ArrowLeftIcon, CheckIcon, CircleDashedIcon, ImageIcon, LoaderCircleIcon, MailIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { usePastCap } from "@/api/use-past-cap";
import { useCountUp } from "@/lib/use-count-up";
import { useAddPublicEmail, useCreatePublicAudit, usePublicAudit } from "./hooks";
import { cn } from "@/lib/utils";

const label = "font-sd-mono text-[11px] tracking-[0.07em] text-[#5f5862]";
const field =
  "h-12 w-full rounded-lg border border-[#dcd8d4] bg-white px-4 text-[15px] text-sd-dark outline-none transition-[border-color,box-shadow] placeholder:text-[#7a737c] focus-visible:border-sd-dark focus-visible:ring-[3px] focus-visible:ring-sd-orange/40 aria-invalid:border-[#c2410c]";
const cta =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-sd-orange px-6 text-[15px] font-semibold text-sd-dark transition-[background-color,transform] hover:bg-[#ec8f00] active:scale-[0.99] focus-visible:ring-[3px] focus-visible:ring-sd-dark/30 focus-visible:outline-none disabled:opacity-60";

const STATUS_WORDS: Record<string, string> = { missing: "Not answered", partial: "Partly answered", contradicted: "Contradicted" };
const STATUS_LOOK: Record<string, { icon: typeof XIcon; cls: string }> = {
  missing: { icon: XIcon, cls: "text-[#b42318]" },
  partial: { icon: CircleDashedIcon, cls: "text-[#9a5b00]" },
  contradicted: { icon: TriangleAlertIcon, cls: "text-[#9f1239]" },
};

export function WidgetPage() {
  const [asin, setAsin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const create = useCreatePublicAudit();
  const result = usePublicAudit(id, since);
  const ids = { asin: useId(), err: useId() };

  function submit(e: FormEvent) {
    e.preventDefault();
    const a = asin.trim().toUpperCase();
    if (!Asin.safeParse(a).success) return setError("Enter a 10-character ASIN starting with B0.");
    const body = { asin: a };
    if (!PublicAuditBody.safeParse(body).success) return setError("Enter a 10-character ASIN starting with B0.");
    setError(null);
    create.mutate(body, {
      onSuccess: (r) => {
        setSince(Date.now());
        setId(r.id);
      },
    });
  }

  const data = result.data;
  const pending = !!id && (!data || data.status === "queued" || data.status === "running");
  // Past the polling cap, or stuck on an error before any result: hand control back to the visitor.
  const stalled = usePastCap(since, pending);
  const lost = pending && !data && result.isError && !result.isFetching;
  const busy = create.isPending || (pending && !stalled && !lost);
  const done = data?.status === "done";

  return (
    <div className="min-h-dvh bg-sd-light font-sd text-sd-dark">
      <div className="border-b border-sd-depth">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-5 py-2 text-[12.5px] text-[#5f5862]">
          <span>Preview: the widget as it would sit on the salesduo.com homepage</span>
          <a href="/" className="inline-flex items-center gap-1 font-semibold text-sd-purple underline-offset-4 hover:underline">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" /> Back to the app
          </a>
        </div>
      </div>

      <main className="mx-auto grid max-w-5xl items-start gap-10 px-5 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:gap-14 md:py-20">
        <div className="md:pt-4">
          <h1 className="max-w-[14ch] text-[38px] leading-[1.04] font-semibold tracking-[-0.025em] sm:text-[50px]">Can Alexa answer your shoppers' questions?</h1>
          <p className="mt-5 max-w-[44ch] text-[17px] leading-relaxed text-[#4a444b]">
            Shoppers now ask Alexa instead of typing keywords. Enter your ASIN to see how much of what they ask your listing answers, and the three
            biggest gaps.
          </p>
          <ul className="mt-7 hidden max-w-[44ch] gap-2.5 text-[15px] text-[#4a444b] md:grid">
            {["A readiness score, weighted by what shoppers ask", "Your three biggest gaps, against your competitors", "Answers you already give, but only in images"].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ccfdcf] text-[#14532d]" aria-hidden="true">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <section aria-label="Check a listing" className="rounded-[1.25rem] bg-white p-6 shadow-[0_1px_0_#ececec,0_16px_40px_-16px_rgba(35,31,35,0.22)] sm:p-8">
          <form onSubmit={submit} noValidate className="grid gap-3">
            <label htmlFor={ids.asin} className={label}>
              ASIN
            </label>
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                id={ids.asin}
                value={asin}
                onChange={(e) => setAsin(e.target.value)}
                placeholder="B0C9W8DD9S"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!error}
                aria-describedby={error ? ids.err : undefined}
                className={cn(field, "font-sd-mono uppercase placeholder:normal-case")}
              />
              <button type="submit" className={cta} disabled={busy}>
                {busy && <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />}
                {busy ? "Checking your listing" : "Check my listing"}
              </button>
            </div>
            {error ? (
              <p id={ids.err} role="alert" className="text-sm text-[#b42318]">
                {error}
              </p>
            ) : (
              <p className="text-[13px] text-[#5f5862]">Find it in your product's Amazon URL, after /dp/.</p>
            )}
          </form>

          <div aria-live="polite">
            {create.error && <p className="mt-5 text-sm text-[#b42318]">{create.error.message}</p>}
            {busy && !create.isPending && <Checking />}
            {(lost || stalled) && (
              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm" role="status">
                <p className={lost ? "text-[#b42318]" : "text-[#4a444b]"}>{lost ? result.error?.message : "This is taking longer than expected."}</p>
                <button type="button" onClick={() => void result.refetch()} className="font-semibold text-sd-purple underline underline-offset-4">
                  {lost ? "Try again" : "Check again"}
                </button>
              </div>
            )}
            {data?.status === "failed" && (
              <p className="mt-5 text-sm text-[#b42318]" role="alert" data-testid="widget-failed">
                {data.reason ?? "The audit couldn't be completed."}
              </p>
            )}
            {done && <Result data={data} />}
          </div>
        </section>
      </main>
    </div>
  );
}

function Checking() {
  return (
    <div className="mt-7 border-t border-sd-depth pt-6" role="status">
      <p className="text-[15px] font-semibold">Reading your listing</p>
      <p className="mt-1 text-sm text-[#5f5862]">Checking every shopper question against your title, bullets, description and images.</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sd-depth" aria-hidden="true">
        <div className="h-full w-1/3 animate-[progress_1.6s_ease-in-out_infinite] rounded-full bg-sd-orange" />
      </div>
    </div>
  );
}

/** A half-ring gauge for the score: the arc fills to the score as it counts up. */
function Gauge({ score, estimated }: { score: number | null | undefined; estimated: boolean }) {
  const shown = useCountUp(score);
  const r = 52;
  const arc = Math.PI * r;
  const filled = typeof shown === "number" ? (shown / 100) * arc : 0;
  return (
    <div className="relative mx-auto w-[184px]">
      <svg viewBox="0 0 128 72" className="w-full" aria-hidden="true">
        <path d="M 12 64 A 52 52 0 0 1 116 64" fill="none" stroke="#ececec" strokeWidth="10" strokeLinecap="round" />
        <path d="M 12 64 A 52 52 0 0 1 116 64" fill="none" stroke="#fd9900" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${filled} ${arc}`} />
      </svg>
      <p className="absolute inset-x-0 bottom-0 flex items-baseline justify-center gap-1">
        <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{shown ?? "n/a"}</span>
        <span className="text-sm text-[#5f5862]">/ 100</span>
      </p>
      {estimated && <span className="sr-only">(estimated)</span>}
    </div>
  );
}

function Status({ status }: { status: string }) {
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.missing!;
  const Icon = look.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold", look.cls)}>
      <Icon className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
      {STATUS_WORDS[status] ?? status}
    </span>
  );
}

function Pips({ of, filled }: { of: number; filled: number }) {
  return (
    <span className="inline-flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", i < filled ? "bg-sd-purple" : "bg-[#dcd8d4]")} />
      ))}
    </span>
  );
}

function Result({ data }: { data: PublicAuditResult }) {
  const estimated = data.scoreBasis === "estimated";
  return (
    <div className="mt-7 border-t border-sd-depth pt-6" data-testid="widget-result">
      <p className={cn(label, "text-center")}>READINESS SCORE</p>
      <div className="mt-3">
        <Gauge score={data.score} estimated={estimated} />
      </div>
      <p className="mx-auto mt-2 max-w-[36ch] text-center text-sm text-[#4a444b]">
        {estimated ? "There aren't enough reviews in this category yet, so the questions were estimated." : "Weighted by how often shoppers ask each question."}
      </p>

      <p className={cn(label, "mt-7")}>TOP 3 GAPS</p>
      <ol className="mt-3 grid gap-2" data-testid="widget-gaps">
        {(data.topGaps ?? []).map((g, i) => (
          <li key={g.question} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5 rounded-xl bg-sd-light px-3.5 py-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-white font-sd-mono text-xs text-sd-purple" aria-hidden="true">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] leading-snug font-semibold">{g.question}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[#5f5862]">
                <Status status={g.status} />
                {g.competitors > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Pips of={g.competitors} filled={g.competitorsAnswering} />
                    {g.competitorsAnswering} of {g.competitors} competitors answer it
                  </span>
                )}
              </p>
              {g.hiddenInImage && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#f4e7c7] px-2 py-1 text-[12.5px] font-semibold text-[#5b4410]">
                  <ImageIcon className="size-3.5" aria-hidden="true" /> You already say it, but only in an image
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <EmailCapture data={data} />
    </div>
  );
}

function EmailCapture({ data }: { data: PublicAuditResult }) {
  const add = useAddPublicEmail();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = PublicEmailBody.safeParse({ email: email.trim() });
    if (!parsed.success) return setError("That email address doesn't look right.");
    setError(null);
    add.mutate({ id: data.id, email: parsed.data.email });
  }

  return (
    <div className="mt-6 rounded-xl bg-sd-purple p-5 text-white sm:p-6" aria-live="polite">
      {data.emailCaptured ? (
        <p className="flex items-start gap-3 text-[15px]" data-testid="email-captured">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#ccfdcf] text-[#14532d]" aria-hidden="true">
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
          <span>
            The full report is on its way{email ? <> to <span className="font-semibold">{email}</span></> : null}: every question, the quotes behind each
            answer, and a fix list written from your own listing.
          </span>
        </p>
      ) : (
        <form onSubmit={submit} noValidate>
          <label htmlFor={inputId} className="flex items-center gap-2 text-[17px] font-semibold">
            <MailIcon className="size-4 text-[#fdba74]" aria-hidden="true" />
            Get the full report by email
          </label>
          <p className="mt-1 text-sm text-white/80">Every question, the quotes behind each answer, and a fix list written from your own listing.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@brand.com"
              autoComplete="email"
              aria-invalid={!!error}
              aria-describedby={error ? errId : undefined}
              className={cn(field, "h-11 sm:flex-1")}
            />
            <button type="submit" className={cn(cta, "h-11 text-[14px]")} disabled={add.isPending}>
              {add.isPending && <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />}
              Send me the report
            </button>
          </div>
          {(error ?? add.error?.message) && (
            <p id={errId} role="alert" className="mt-2 text-sm text-[#ffd7cc]">
              {error ?? add.error?.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
