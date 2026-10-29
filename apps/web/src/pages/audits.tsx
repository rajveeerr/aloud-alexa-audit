import { Link } from "react-router";
import { useAudits } from "@/api/hooks";
import { Page } from "@/components/app-shell";
import { JobStatus, ScoreCell } from "@/components/job-status";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const SOURCE = { serpapi: "Live", dataset: "2023 dataset", paste: "Pasted" } as const;
const ORIGIN = { app: "App", api: "API", widget: "Widget", rescore: "Re-score", bulk: "Bulk" } as const;

export function AuditsPage() {
  const audits = useAudits(100);

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audits</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Every audit run from the app, the API, bulk jobs and re-scores.</p>
        </div>
        <Button asChild>
          <Link to="/">New audit</Link>
        </Button>
      </div>

      <div className="mt-6 rounded-xl border">
        {audits.isError ? (
          <p role="alert" className="p-6 text-[15px] text-destructive">
            {audits.error.message}
          </p>
        ) : audits.data?.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-semibold">No audits yet</p>
            <p className="mt-1 text-[15px] text-muted-foreground">Run one from an ASIN and it shows up here.</p>
            <Button asChild className="mt-4">
              <Link to="/">Run an audit</Link>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="pl-4">Product</TableHead>
                <TableHead>ASIN</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="pr-4">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-busy={audits.isLoading}>
              {audits.isLoading &&
                [0, 1, 2, 3].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="px-4">
                      <div className="h-5 animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))}
              {audits.data?.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/50">
                  <TableCell className="max-w-[340px] pl-4">
                    <Link to={`/audits/${a.id}`} className="block rounded-sm font-semibold hover:text-primary-ink">
                      <span className="block truncate">{a.title ?? a.asin}</span>
                    </Link>
                    {a.brand && <span className="text-[13px] text-muted-foreground">{a.brand}</span>}
                  </TableCell>
                  <TableCell className="font-mono text-[13px]">{a.asin}</TableCell>
                  <TableCell className="text-muted-foreground">{a.category ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {SOURCE[a.source]}
                    <span className="block text-xs">{ORIGIN[a.origin]}</span>
                  </TableCell>
                  <TableCell>
                    <JobStatus status={a.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ScoreCell score={a.score} />
                  </TableCell>
                  <TableCell className="pr-4 whitespace-nowrap text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Page>
  );
}
