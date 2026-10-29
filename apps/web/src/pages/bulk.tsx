import { Asin } from "@answerable/contracts";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useBulk, useBulkJobs, useCreateBulk } from "@/api/hooks";
import { usePastCap } from "@/api/use-past-cap";
import type { SavedSource } from "@/api";
import { Page } from "@/components/app-shell";
import { JobStatus, ScoreCell } from "@/components/job-status";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";

const EXAMPLE = "B0C9W8DD9S\nB001GAOTSW\nB0BGPYR8Q3\nB0BSMKF5BQ\nB097CF46RC";

function parseAsins(text: string) {
  const tokens = text.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const unique = [...new Set(tokens)];
  return { valid: unique.filter((t) => Asin.safeParse(t).success), invalid: unique.filter((t) => !Asin.safeParse(t).success) };
}

export function BulkPage() {
  const [name, setName] = useState("Gel pens, October");
  const [text, setText] = useState(EXAMPLE);
  const [source, setSource] = useState<SavedSource>("serpapi");
  const [activeId, setActiveId] = useState<string | null>(null);
  const create = useCreateBulk();
  const jobs = useBulkJobs();
  const ids = { name: useId(), asins: useId(), help: useId() };
  const { valid, invalid } = parseAsins(text);

  const shownId = activeId ?? jobs.data?.[0]?.id ?? null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid.length === 0 || invalid.length > 0 || !name.trim()) return;
    create.mutate({ name: name.trim(), asins: valid.slice(0, 200), source }, { onSuccess: (b) => setActiveId(b.id) });
  }

  return (
    <Page>
      <h1 className="text-2xl font-bold">Bulk audit</h1>
      <p className="mt-1 max-w-[68ch] text-[15px] text-muted-foreground">
        Audit a whole catalog at once. Each ASIN runs as its own job through the queue, so a big list finishes in the background.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <form onSubmit={submit} noValidate className="grid gap-4 rounded-xl border p-5" aria-label="New bulk job">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.name}>Name</Label>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.asins}>ASINs</Label>
            <Textarea
              id={ids.asins}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              spellCheck={false}
              className="font-mono text-[13px] uppercase"
              aria-invalid={invalid.length > 0}
              aria-describedby={ids.help}
            />
            <p id={ids.help} className={cn("text-[13px]", invalid.length ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {invalid.length
                ? `Not valid ASINs: ${invalid.slice(0, 4).join(", ")}${invalid.length > 4 ? ` and ${invalid.length - 4} more` : ""}`
                : `${valid.length} ASINs, one per line or separated by commas. Up to 200.`}
            </p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold">Source</span>
            <Segmented
              label="Listing source"
              value={source}
              onChange={setSource}
              options={[
                { value: "serpapi", label: "Live page" },
                { value: "dataset", label: "Saved (2023 dataset)" },
              ]}
            />
          </div>
          <Button type="submit" disabled={create.isPending || valid.length === 0 || invalid.length > 0}>
            Start {valid.length || ""} audits
          </Button>
          {create.error && (
            <p role="alert" className="text-sm text-destructive">
              {create.error.message}
            </p>
          )}
        </form>

        <div className="min-w-0">
          {shownId ? (
            <BulkTable id={shownId} />
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="font-semibold">No bulk jobs yet</p>
              <p className="mt-1 text-[15px] text-muted-foreground">Start one and its progress shows here, row by row.</p>
            </div>
          )}
          {(jobs.data?.length ?? 0) > 1 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-muted-foreground">Earlier jobs</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {jobs.data!.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      aria-pressed={b.id === shownId}
                      onClick={() => setActiveId(b.id)}
                      className="rounded-full border px-3 py-1 text-[13px] hover:bg-muted aria-pressed:border-[#f5b56a] aria-pressed:bg-tint"
                    >
                      {b.name} <span className="text-muted-foreground">{formatDate(b.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

function BulkTable({ id }: { id: string }) {
  const bulk = useBulk(id);
  const stalled = usePastCap(bulk.data?.createdAt, bulk.data?.status === "running");
  if (!bulk.data) {
    if (bulk.isError) {
      return (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border p-5 text-sm">
          <p className="text-destructive">{bulk.error.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void bulk.refetch()} disabled={bulk.isFetching}>
            Try again
          </Button>
        </div>
      );
    }
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }
  const b = bulk.data;
  const pct = b.total ? Math.round(((b.done + b.failed) / b.total) * 100) : 0;

  return (
    <section aria-labelledby="bulk-title" className="rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 id="bulk-title" className="font-semibold">
            {b.name}
          </h2>
          <p className="text-[13px] text-muted-foreground" aria-live="polite" data-testid="bulk-progress">
            {b.done} of {b.total} done{b.failed ? `, ${b.failed} failed` : ""}
          </p>
        </div>
        <JobStatus status={b.status === "done" ? "done" : "running"} />
      </div>
      {(stalled || bulk.isError) && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2 text-sm" role="status">
          <p>{stalled ? "This is taking longer than expected." : `Lost touch with the API (${bulk.error?.message}). Retrying on its own.`}</p>
          {stalled && (
            <Button type="button" variant="outline" size="sm" onClick={() => void bulk.refetch()} disabled={bulk.isFetching}>
              Refresh
            </Button>
          )}
        </div>
      )}
      <div
        className="h-1 bg-muted"
        role="progressbar"
        aria-label="Bulk job progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full origin-left bg-primary transition-transform duration-200 ease-out" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">ASIN</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="pr-4 text-right">Report</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {b.audits.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="pl-4 font-mono text-[13px]">{a.asin}</TableCell>
              <TableCell>
                <JobStatus status={a.status} />
              </TableCell>
              <TableCell className="text-right">{a.status === "done" ? <ScoreCell score={a.score} /> : <span className="text-muted-foreground">-</span>}</TableCell>
              <TableCell className="pr-4 text-right">
                {a.status === "done" || a.status === "failed" ? (
                  <Link to={`/audits/${a.id}`} className="font-semibold text-primary-ink hover:underline">
                    {a.status === "failed" ? "Why it failed" : "Open"}
                    <span className="sr-only"> {a.asin}</span>
                  </Link>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
