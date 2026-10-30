import type { AuditJob } from "@aloud/contracts";
import { CircleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useAudit } from "@/api/hooks";
import { usePastCap } from "@/api/use-past-cap";
import { Page } from "@/components/app-shell";
import { FixList } from "@/components/report/fix-list";
import { GapMatrix } from "@/components/report/gap-matrix";
import { HiddenAnswers } from "@/components/report/hidden-answers";
import { HowScored, Notes } from "@/components/report/how-scored";
import { ListingPanel } from "@/components/report/listing-panel";
import { PromiseVsProof } from "@/components/report/proof";
import { QuestionList } from "@/components/report/questions";
import { ReportHeader } from "@/components/report/report-header";
import { Section } from "@/components/report/section";
import { Button } from "@/components/ui/button";
import { indexReport, isEstimated, type Report } from "@/lib/report";
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
        stalled={stalled}
        connection={audit.isError ? audit.error.message : undefined}
        onRefresh={retry}
        refreshing={audit.isFetching}
      />
    );
  }
  return <ReportView report={job.report} auditId={job.id} />;
}

const STEPS = ["Fetch the listing", "Pick the category's shopper questions", "Grade every question and check each quote", "Read the images for hidden answers", "Grade competitors", "Draft the fix list"];

function Progress({
  status,
  asin,
  note,
  stalled = false,
  connection,
  onRefresh,
  refreshing = false,
}: {
  status: AuditJob["status"];
  asin: string | null;
  note: string | undefined;
  /** Polled past the cap: polling stopped, so offer a manual refresh. */
  stalled?: boolean;
  /** The last poll's error, while it retries. */
  connection?: string | undefined;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <Page>
      <div className="mx-auto max-w-xl py-10" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-muted-foreground">{asin ? <span className="font-mono">{asin}</span> : "Audit"}</p>
        <h1 className="mt-1 text-2xl font-bold" data-testid="audit-status">
          {status === "queued" ? "Queued" : "Running the audit"}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {status === "queued" ? "Waiting for a worker to pick it up." : "Usually under a minute. This page updates on its own."}
        </p>
        {note && (
          <p className="mt-3 rounded-md border border-[#fcd9a8] bg-tint px-3 py-2 text-sm text-[#7c2d12]" data-testid="audit-note">
            {note}
          </p>
        )}
        {connection && !stalled && (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="audit-reconnecting">
            Lost touch with the API ({connection}). Retrying on its own.
          </p>
        )}
        {stalled && onRefresh && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5" data-testid="audit-stalled">
            <p className="text-sm">This is taking longer than expected.</p>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              Refresh
            </Button>
          </div>
        )}
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn("h-full rounded-full bg-primary", status === "queued" ? "w-[8%]" : "w-1/3 animate-[progress_1.6s_ease-in-out_infinite]")} />
        </div>
        <ol className="mt-6 grid gap-2 text-[15px] text-muted-foreground">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className="flex size-6 items-center justify-center rounded-full border text-xs tabular-nums">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
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

const JUMPS = [
  { href: "#hidden", label: "Hidden answers" },
  { href: "#proof", label: "Promise vs proof" },
  { href: "#questions", label: "Questions" },
  { href: "#competitors", label: "Competitors" },
  { href: "#fixes", label: "Fix list" },
  { href: "#scoring", label: "How it's scored" },
];

function ReportView({ report, auditId }: { report: Report; auditId: string }) {
  const index = useMemo(() => indexReport(report), [report]);
  const [selected, setSelected] = useState<string | null>(null);
  const allQuotes = useMemo(() => report.grades.flatMap((g) => g.quotes), [report]);
  const selectedQuotes = report.grades.find((g) => g.intentId === selected)?.quotes ?? [];

  return (
    <Page className="pt-6 sm:pt-8">
      <ReportHeader report={report} />

      <nav aria-label="Report sections" className="sticky top-14 z-30 -mx-4 mt-8 border-b bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {JUMPS.map((j) => (
            <li key={j.href}>
              <a href={j.href} className="block rounded-md px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground">
                {j.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-12 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">
        <HiddenAnswers report={report} index={index} />
        <PromiseVsProof report={report} index={index} />

        <Section
          id="questions"
          title="Questions shoppers ask"
          description={
            isEstimated(report)
              ? "Estimated for this category. Select a question to see where its answer sits in the listing."
              : `Mined from ${report.intentSet.sampleSize.toLocaleString()} reviews in ${report.intentSet.categoryName}, worst first. Select a question to see where its answer sits in the listing.`
          }
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
            <QuestionList report={report} index={index} selected={selected} onSelect={(id) => setSelected((s) => (s === id ? null : id))} />
            <div className="lg:sticky lg:top-28">
              <ListingPanel report={report} selected={selectedQuotes} all={allQuotes} />
            </div>
          </div>
        </Section>

        <GapMatrix report={report} />
        <FixList report={report} index={index} auditId={auditId} />
        <Notes report={report} />
        <HowScored report={report} />
      </div>
    </Page>
  );
}
