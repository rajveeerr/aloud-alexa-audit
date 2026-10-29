/** Database rows to the contract's response types. Kept apart from routes so they're easy to test. */
import type { AsinHistory, AuditJob, AuditReport, AuditSummary, BulkJob, PublicAuditResult, StudioBriefs } from "@answerable/contracts";
import type { AuditRow, AuditStatusValue, AuditSummaryRow, BulkJobRow } from "@answerable/db";

const iso = (d: Date | null) => (d ? d.toISOString() : undefined);

export function toAuditJob(row: AuditRow): AuditJob {
  const completedAt = iso(row.completedAt);
  const error = row.error as AuditJob["error"] | null;
  return {
    id: row.id,
    asin: row.asin,
    source: row.source,
    origin: row.origin,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(completedAt && { completedAt }),
    ...(row.status === "failed" && error && { error }),
    ...(row.status === "done" && { score: row.score }),
    ...(row.contentHash && { contentHash: row.contentHash }),
    ...(row.note && { note: row.note }),
    ...(row.status === "done" && row.report ? { report: row.report as AuditReport } : {}),
  };
}

export function toSummary(row: AuditSummaryRow): AuditSummary {
  const completedAt = iso(row.completedAt);
  return {
    id: row.id,
    asin: row.asin,
    source: row.source,
    origin: row.origin,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(completedAt && { completedAt }),
    ...(row.status === "done" && { score: row.score }),
    ...(row.brand && { brand: row.brand }),
    ...(row.title && { title: row.title }),
    ...(row.categoryName && { category: row.categoryName }),
  };
}

export function toHistory(asin: string, rows: AuditSummaryRow[]): AsinHistory {
  return {
    asin,
    points: rows.map((r) => ({
      auditId: r.id,
      at: (r.completedAt ?? r.createdAt).toISOString(),
      score: r.score,
      contentHash: r.contentHash ?? "",
      origin: r.origin,
    })),
  };
}

export function toBriefs(row: AuditRow): StudioBriefs {
  const report = row.report as AuditReport;
  return { auditId: row.id, asin: row.asin, category: report.intentSet.categoryName, briefs: report.briefs };
}

export function toBulkJob(job: BulkJobRow, audits: { id: string; asin: string; status: AuditStatusValue; score: number | null }[]): BulkJob {
  const done = audits.filter((a) => a.status === "done").length;
  const failed = audits.filter((a) => a.status === "failed").length;
  return {
    id: job.id,
    name: job.name,
    status: done + failed >= job.total ? "done" : "running",
    total: job.total,
    done,
    failed,
    createdAt: job.createdAt.toISOString(),
    audits,
  };
}

/** Visitors see a fixed sentence per error code, never the stored message. */
export function publicReason(code: string | undefined): string {
  switch (code) {
    case "listing_not_found":
    case "not_recorded":
      return "We can't audit this product yet. Try one of the example products.";
    case "provider_unavailable":
    case "enqueue_failed":
    case "stalled":
      return "The audit couldn't finish right now. Please try again later.";
    default:
      return "The audit couldn't be completed.";
  }
}

/**
 * How many competitors answer a question, fully or partly, out of those it applies to.
 * Shoppers read "4 of 4" more easily than the weighted share used for ranking.
 */
export function competitorCounts(report: Pick<AuditReport, "competitors">, intentId: string): { competitorsAnswering: number; competitors: number } {
  let competitors = 0;
  let competitorsAnswering = 0;
  for (const c of report.competitors ?? []) {
    const g = c.grades.find((x) => x.intentId === intentId);
    if (!g || g.status === "not_applicable") continue;
    competitors++;
    if (g.status === "answered" || g.status === "partial") competitorsAnswering++;
  }
  return { competitorsAnswering, competitors };
}

/**
 * The widget's teaser: the score and the three highest-priority gaps, never the full report.
 * The rest is the reason to leave an email.
 */
export function toPublicResult(row: AuditRow, emailCaptured: boolean): PublicAuditResult {
  const out: PublicAuditResult = { id: row.id, status: row.status, asin: row.asin, emailCaptured };
  if (row.status === "failed") return { ...out, reason: publicReason((row.error as { code?: string } | null)?.code) };
  if (row.status !== "done" || !row.report) return out;
  const report = row.report as AuditReport;
  const questions = new Map(report.intentSet.intents.map((i) => [i.id, i.question]));
  const topGaps = [...report.gaps]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map((g) => ({
      question: questions.get(g.intentId) ?? g.intentId,
      status: g.status,
      competitorShare: g.competitorShare,
      ...competitorCounts(report, g.intentId),
      hiddenInImage: g.hiddenClaims.length > 0,
    }));
  return { ...out, score: row.score, scoreBasis: report.intentSet.basis, topGaps };
}
