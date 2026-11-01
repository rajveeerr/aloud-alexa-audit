import type { AuditJob } from "@aloud/contracts";
import { CircleAlertIcon, Clock3Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useAudit } from "@/api/hooks";
import { usePastCap } from "@/api/use-past-cap";
import { Page } from "@/components/app-shell";
import { FixList } from "@/components/report/fix-list";
import { GapMatrix } from "@/components/report/gap-matrix";
import { HiddenAnswers } from "@/components/report/hidden-answers";
import { HowScored } from "@/components/report/how-scored";
import { ListingPanel } from "@/components/report/listing-panel";
import { PromiseVsProof } from "@/components/report/proof";
import { QuestionList } from "@/components/report/questions";
import { ReportHeader, Verdict } from "@/components/report/report-header";
import { ReportNav, type NavItem } from "@/components/report/report-nav";
import { SendToStudio } from "@/components/report/send-to-studio";
import { TopFixes } from "@/components/report/top-fixes";
import { Section } from "@/components/report/section";
import { Button } from "@/components/ui/button";
import { indexReport, type Report } from "@/lib/report";
import { cn } from "@/lib/utils";

export function AuditPage() {
  const { id = "" } = useParams();
  const audit = useAudit(id);
  const retry = () => void audit.refetch();
  const pending = audit.data !== undefined && audit.data.status !== "done" && audit.data.status !== "failed";
  const stalled = usePastCap(audit.data?.createdAt, pending);

  // An error only takes the page over when there's nothing to show yet; a failed poll of a
  // running audit keeps the progress view and retries in the background.
  if (audit.data === undefined) {
    if (audit.isError) return <Failed title="Couldn't load this audit" message={audit.error.message} onRetry={retry} retrying={audit.isFetching} />;
    return <Progress status="queued" asin={null} note={undefined} />;
  }

  const job = audit.data;
  if (job.status === "failed") return <Failed title={`The audit of ${job.asin} failed`} message={job.error?.message ?? "No reason was given."} code={job.error?.code} />;
  if (job.status !== "done" || !job.report) {
    return (
      <Progress
        status={job.status}
        asin={job.asin}
        note={job.note}
        createdAt={job.createdAt}
        stalled={stalled}
        connection={audit.isError ? audit.error.message : undefined}
        onRefresh={retry}
        refreshing={audit.isFetching}
      />
    );
  }
  return <ReportView report={job.report} auditId={job.id} />;
}

const STEPS = [
  "Fetch the listing",
  "Pick the category's shopper questions",
  "Grade every question and check each quote",
  "Read the images for hidden answers",
  "Grade competitors",
  "Draft the fix list",
];

/** Seconds since `from`, ticking once a second while mounted. */
function useElapsed(from: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const start = from ? Date.parse(from) : NaN;
  return Number.isFinite(start) ? Math.max(0, Math.round((now - start) / 1000)) : null;
}

/**
 * The worker's note for an audit parked behind the model's daily quota ends in the reset time as an
 * ISO timestamp; show it in the viewer's own time zone. Null when the note is about something else.
 */
function quotaReset(note: string | undefined): { at: string | null } | null {
  if (!note || !/quota/i.test(note)) return null;
  const iso = note.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1];
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return { at: null };
  const d = new Date(t);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const when = d.toDateString() === day(0) ? "today" : d.toDateString() === day(1) ? "tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" });
  return { at: `${time} ${when}` };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Progress({
  status,
  asin,
  note,
  createdAt,
  stalled = false,
  connection,
  onRefresh,
  refreshing = false,
}: {
  status: AuditJob["status"];
  asin: string | null;
  note: string | undefined;
  createdAt?: string | undefined;
  /** Polled past the cap: polling stopped, so offer a manual refresh. */
  stalled?: boolean;
  /** The last poll's error, while it retries. */
  connection?: string | undefined;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  // Set by the audit form when it asked for a live fetch: those take longer, so say so.
  const live = (useLocation().state as { live?: boolean } | null)?.live === true;
  const elapsed = useElapsed(createdAt);
  const expect = live ? "Fetching a new product from Amazon usually takes 1 to 2 minutes." : "Usually under a minute.";
  const quota = quotaReset(note);

  return (
    <Page>
      <div className="mx-auto max-w-xl py-6 sm:py-10">
        <div className="rounded-2xl border bg-card p-6 shadow-card sm:p-8" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-muted-foreground">{asin ? <span className="font-mono">{asin}</span> : "Audit"}</p>
            {elapsed !== null && !quota && (
              <p className="text-sm text-muted-foreground tabular-nums" aria-hidden="true">
                {clock(elapsed)}
              </p>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.015em]" data-testid="audit-status">
            {status === "queued" ? "Queued" : "Running the audit"}
          </h1>
          {quota ? (
            <div className="mt-4 flex gap-3 rounded-xl border border-[#fcd9a8] bg-tint px-4 py-3.5 text-[#7c2d12]" data-testid="audit-note">
              <Clock3Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold">
                  Waiting for the model's daily quota to reset{quota.at ? ` at ${quota.at}` : ""}.
                </p>
                <p className="mt-1">The audit carries on by itself after that. You can close this page and find it later under Audits.</p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[15px] text-muted-foreground">
              {status === "queued" ? "Waiting for a worker to pick it up." : `${expect} This page updates on its own.`}
            </p>
          )}
          {note && !quota && (
            <p className="mt-3 rounded-lg border border-[#fcd9a8] bg-tint px-3 py-2 text-sm text-[#7c2d12]" data-testid="audit-note">
              {note}
            </p>
          )}
          {connection && !stalled && (
            <p className="mt-3 text-sm text-muted-foreground" data-testid="audit-reconnecting">
              Lost touch with the API ({connection}). Retrying on its own.
            </p>
          )}
          {stalled && onRefresh && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5" data-testid="audit-stalled">
              <p className="text-sm">This is taking longer than expected.</p>
              <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                Refresh
              </Button>
            </div>
          )}
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className={cn("h-full rounded-full bg-primary", status === "queued" || quota ? "w-[8%]" : "w-1/3 animate-[progress_1.6s_ease-in-out_infinite]")} />
          </div>
          <p className="mt-6 text-[13px] font-semibold text-muted-foreground">What the audit does</p>
          <ol className="mt-2 grid gap-2.5 text-[15px]">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Page>
  );
}

function Failed({
  title,
  message,
  code,
  onRetry,
  retrying = false,
}: {
  title: string;
  message: string;
  code?: string | undefined;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Page>
      <div className="mx-auto max-w-xl py-10" role="alert">
        <CircleAlertIcon className="size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-[15px]">{message}</p>
        {code && <p className="mt-1 font-mono text-[13px] text-muted-foreground">{code}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {onRetry && (
            <Button type="button" onClick={onRetry} disabled={retrying}>
              Try again
            </Button>
          )}
          <Button asChild variant={onRetry ? "outline" : "default"}>
            <Link to="/">Start a new audit</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/audits">All audits</Link>
          </Button>
        </div>
      </div>
    </Page>
  );
}

function ReportView({ report, auditId }: { report: Report; auditId: string }) {
  const index = useMemo(() => indexReport(report), [report]);
  const [selected, setSelected] = useState<string | null>(null);
  const allQuotes = useMemo(() => report.grades.flatMap((g) => g.quotes), [report]);
  const selectedQuotes = report.grades.find((g) => g.intentId === selected)?.quotes ?? [];
  const scoredCount = report.grades.filter((g) => index.intents.get(g.intentId)?.kind !== "experience").length;

  const nav: NavItem[] = [
    { id: "hidden", label: "Hidden answers", count: report.imageClaims.length > 0 ? report.hiddenAnswers.length : undefined },
    { id: "questions", label: "Questions", count: scoredCount },
    { id: "competitors", label: "Competitors", count: report.competitors.length > 0 ? report.gaps.length : undefined },
    ...(report.proof ? [{ id: "proof", label: "Promise vs proof", count: report.proof.claims.length }] : []),
    { id: "fixes", label: "Fix list", count: report.briefs.length },
    { id: "scoring", label: "How it's scored" },
  ];

  return (
    <Page className="pt-6 sm:pt-8">
      <ReportHeader report={report} />
      <div className="mt-6 grid gap-8">
        <Verdict report={report} />
        <TopFixes report={report} />
      </div>

      <div className="mt-10">
        <ReportNav items={nav} action={<SendToStudio auditId={auditId} disabled={report.briefs.length === 0} size="sm" />} />
      </div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-14 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">
        <HiddenAnswers report={report} index={index} />

        <Section id="questions" title="Questions shoppers ask">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
            <QuestionList report={report} index={index} selected={selected} onSelect={(id) => setSelected((s) => (s === id ? null : id))} />
            <div className="lg:sticky lg:top-32">
              <ListingPanel report={report} selected={selectedQuotes} all={allQuotes} />
            </div>
          </div>
        </Section>

        <GapMatrix report={report} />
        <PromiseVsProof report={report} index={index} />
        <FixList report={report} index={index} />
        <HowScored report={report} />
      </div>
      <footer className="mt-14 border-t pt-4 font-mono text-xs text-muted-foreground" data-testid="score-formula">
        score = 100 × Σ(frequency × weight) / Σ(frequency) · weight: answered 1, partly 0.5, missing 0, contradicted 0
      </footer>
    </Page>
  );
}
