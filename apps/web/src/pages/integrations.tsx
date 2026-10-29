import { ArrowDownIcon, GitCommitHorizontalIcon, LoaderCircleIcon, WebhookIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAudit, useAudits, useHistory, useRescore } from "@/api/hooks";
import { Page } from "@/components/app-shell";
import { HistoryChart } from "@/components/history-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACTION_LABEL, targetLabel } from "@/lib/report";

const HERO = "B0C9W8DD9S";

function Mockup({ id, title, surface, endpoint, children }: { id: string; title: string; surface: string; endpoint: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t pt-8">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="text-xl font-bold">
          {title}
        </h2>
        <Badge variant="outline">Mockup</Badge>
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        Plugs into {surface} through <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{endpoint}</code>
      </p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function IntegrationsPage() {
  return (
    <Page>
      <h1 className="text-2xl font-bold">Where this plugs into SalesDuo</h1>
      <p className="mt-1 max-w-[68ch] text-[15px] text-muted-foreground">
        Sketches of the three hand-offs. The data in each comes from the API; the surrounding SalesDuo screens are mockups, not their real UI.
      </p>
      <div className="mt-8 grid gap-12">
        <Mockup id="bi" title="BI dashboard tile" surface="the BI dashboard" endpoint={`GET /v1/asins/:asin/history`}>
          <BiTile />
        </Mockup>
        <Mockup id="cohesity" title="Cohesity re-score" surface="Cohesity's listing change log" endpoint="POST /v1/rescore">
          <Rescore />
        </Mockup>
        <Mockup id="studio" title="Creative Studio hand-off" surface="AI Creative Studio" endpoint="POST /v1/audits/:id/briefs">
          <StudioHandoff />
        </Mockup>
      </div>
    </Page>
  );
}

function BiTile() {
  const history = useHistory(HERO);
  return (
    <div className="grid gap-4 rounded-xl bg-muted/60 p-4 sm:p-6 md:grid-cols-3">
      <div className="rounded-lg border bg-background p-4 md:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold">AI shelf readiness</h3>
            <p className="text-[13px] text-muted-foreground">
              Ddaowanx Gel Pens <span className="font-mono">{HERO}</span>
            </p>
          </div>
          <span className="text-[13px] text-muted-foreground">Last 4 weeks</span>
        </div>
        <div className="mt-3">
          {history.isPending ? (
            <div className="h-28 animate-pulse rounded bg-muted" />
          ) : history.isError ? (
            <p className="text-sm text-destructive">{history.error.message}</p>
          ) : (
            <HistoryChart points={history.data.points} />
          )}
        </div>
      </div>
      <div className="grid content-start gap-4">
        {["Paid share of voice", "Organic share of voice"].map((m) => (
          <div key={m} className="rounded-lg border border-dashed bg-background p-4">
            <p className="text-[13px] text-muted-foreground">{m}</p>
            <p className="mt-1 text-sm text-muted-foreground">Existing BI tile</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Rescore() {
  const rescore = useRescore();
  const r = rescore.data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ol className="grid gap-0 rounded-xl border p-5" aria-label="Example change log">
        <li className="flex gap-3">
          <GitCommitHorizontalIcon className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[15px] font-semibold">Listing edited in Seller Central</p>
            <p className="text-[13px] text-muted-foreground">Bullet 2 now says “Smooth Writing without Skipping”. Content hash changed.</p>
          </div>
        </li>
        <li className="ml-2 py-2 text-muted-foreground" aria-hidden="true">
          <ArrowDownIcon className="size-4" />
        </li>
        <li className="flex gap-3">
          <WebhookIcon className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[15px] font-semibold">Cohesity calls the re-score webhook</p>
            <p className="text-[13px] text-muted-foreground">Unchanged content is skipped, so reverts and no-op saves cost nothing.</p>
          </div>
        </li>
        <li className="ml-2 py-2 text-muted-foreground" aria-hidden="true">
          <ArrowDownIcon className="size-4" />
        </li>
        <li className="rounded-lg bg-tint p-4">
          <p className="text-[13px] text-[#7c2d12]">Example</p>
          <p className="mt-1 text-lg font-semibold">This edit took answerability 54 to 81</p>
        </li>
      </ol>
      <div className="rounded-xl border p-5">
        <h3 className="text-[15px] font-semibold">Try the webhook</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sends a re-score for the hero listing. It hasn't changed since its last audit, so it should be skipped.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[12px]">
          {JSON.stringify({ asin: HERO, source: "serpapi", reason: "cohesity: listing_updated" }, null, 2)}
        </pre>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          disabled={rescore.isPending}
          onClick={() => rescore.mutate({ asin: HERO, source: "serpapi", reason: "cohesity: listing_updated" })}
        >
          {rescore.isPending && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
          Send re-score
        </Button>
        <div aria-live="polite" className="mt-3 text-sm">
          {rescore.error && <p className="text-destructive">{rescore.error.message}</p>}
          {r && (
            <p>
              {r.skipped ? "Skipped: the content hasn't changed. " : "Queued a new audit. "}
              <Link to={`/audits/${r.auditId}`} className="font-semibold text-primary-ink hover:underline">
                Open audit
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StudioHandoff() {
  const audits = useAudits(50);
  const latest = audits.data?.find((a) => a.status === "done" && a.asin === HERO) ?? audits.data?.find((a) => a.status === "done");
  return latest ? <StudioCard id={latest.id} /> : <p className="text-sm text-muted-foreground">Run an audit to see its first brief here.</p>;
}

function StudioCard({ id }: { id: string }) {
  const audit = useAudit(id);
  const report = audit.data?.report;
  const brief = report?.briefs[0];
  if (!report || !brief) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
      <div className="rounded-xl border p-5">
        <p className="text-[13px] text-muted-foreground">answerable, fix #1</p>
        <p className="mt-1 text-[15px] font-semibold">{brief.question}</p>
        <p className="mt-2 text-sm">
          {ACTION_LABEL[brief.action]}, into {targetLabel(brief.target).toLowerCase()}
        </p>
        <Link to={`/audits/${id}#fixes`} className="mt-3 inline-block text-sm font-semibold text-primary-ink hover:underline">
          See the full fix list
        </Link>
      </div>
      <ArrowDownIcon className="mx-auto size-5 text-muted-foreground md:-rotate-90" aria-hidden="true" />
      <div className="rounded-xl border-2 border-primary/60 bg-tint p-5">
        <p className="text-[13px] font-semibold text-[#7c2d12]">Creative Studio, new A+ / bullet draft</p>
        <dl className="mt-2 grid gap-1.5 text-sm">
          <div>
            <dt className="text-muted-foreground">Brief</dt>
            <dd className="font-semibold">{brief.draft ?? brief.needsFromBrand}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Facts from</dt>
            <dd>{brief.sources.map((s) => `${s.kind} ${s.id}`).join(", ") || "the brand (requested)"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] text-muted-foreground">Then re-audit to confirm the question now counts as answered.</p>
      </div>
    </div>
  );
}
