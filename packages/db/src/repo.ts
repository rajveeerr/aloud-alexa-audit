import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, inArray, or } from "drizzle-orm";
import type { Db } from "./client";
import { apiKeys, audits, bulkJobs, leads, listingSnapshots, type AuditOriginValue, type AuditRow, type AuditSource } from "./schema";

export type NewAudit = {
  asin: string;
  source: AuditSource;
  origin: AuditOriginValue;
  /** Everything else runAudit needs, kept so the worker can run it later. */
  request: Record<string, unknown>;
  bulkJobId?: string;
};

export type AuditOutcome = {
  asin: string;
  score: number | null;
  basis: "mined" | "estimated";
  categoryId: string;
  categoryName: string;
  brand: string | null;
  title: string | null;
  contentHash: string;
  report: unknown;
  usage: unknown;
};

export type AuditFailure = { code: string; message: string };

function auditValues(a: NewAudit, now: Date) {
  return {
    id: randomUUID(),
    asin: a.asin,
    requestedAsin: a.asin,
    source: a.source,
    origin: a.origin,
    status: "queued" as const,
    request: a.request,
    bulkJobId: a.bulkJobId ?? null,
    createdAt: now,
  };
}

export async function createAudit(db: Db, a: NewAudit): Promise<AuditRow> {
  const values = auditValues(a, new Date());
  await db.insert(audits).values(values);
  return (await getAudit(db, values.id))!;
}

export async function getAudit(db: Db, id: string): Promise<AuditRow | null> {
  const rows = await db.select().from(audits).where(eq(audits.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markRunning(db: Db, id: string): Promise<void> {
  await db.update(audits).set({ status: "running", startedAt: new Date(), note: null }).where(eq(audits.id, id));
}

/** Back in the queue: waiting for a retry or for the model quota to reset. */
export async function markQueued(db: Db, id: string, note: string): Promise<void> {
  await db.update(audits).set({ status: "queued", note }).where(eq(audits.id, id));
}

export async function markDone(db: Db, id: string, o: AuditOutcome): Promise<void> {
  await db
    .update(audits)
    .set({ ...o, status: "done", error: null, note: null, completedAt: new Date() })
    .where(eq(audits.id, id));
}

export async function markFailed(db: Db, id: string, error: AuditFailure): Promise<void> {
  await db.update(audits).set({ status: "failed", error, note: null, completedAt: new Date() }).where(eq(audits.id, id));
}

/** Everything but the report, which can be large. */
const { report: _report, ...summaryColumns } = getTableColumns(audits);
export type AuditSummaryRow = Omit<AuditRow, "report">;

export async function listAudits(db: Db, limit: number): Promise<AuditSummaryRow[]> {
  return db.select(summaryColumns).from(audits).orderBy(desc(audits.createdAt)).limit(limit);
}

/** Done audits of an ASIN, oldest first. Matches the requested ASIN too, so variants still line up. */
export async function history(db: Db, asin: string): Promise<AuditSummaryRow[]> {
  return db
    .select(summaryColumns)
    .from(audits)
    .where(and(eq(audits.status, "done"), or(eq(audits.asin, asin), eq(audits.requestedAsin, asin))))
    .orderBy(asc(audits.completedAt));
}

export async function latestDone(db: Db, asin: string, source: AuditSource): Promise<AuditSummaryRow | null> {
  const rows = await db
    .select(summaryColumns)
    .from(audits)
    .where(and(eq(audits.status, "done"), eq(audits.source, source), or(eq(audits.asin, asin), eq(audits.requestedAsin, asin))))
    .orderBy(desc(audits.completedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Creates the bulk job and one queued audit per ASIN in a single transaction. */
export async function createBulk(
  db: Db,
  b: { name: string; source: AuditSource; asins: string[]; request: Record<string, unknown> },
): Promise<{ id: string; auditIds: string[] }> {
  const id = randomUUID();
  const now = new Date();
  const rows = b.asins.map((asin) => auditValues({ asin, source: b.source, origin: "bulk", request: b.request, bulkJobId: id }, now));
  await db.transaction(async (tx) => {
    await tx.insert(bulkJobs).values({ id, name: b.name, source: b.source, total: rows.length, createdAt: now });
    await tx.insert(audits).values(rows);
  });
  return { id, auditIds: rows.map((r) => r.id) };
}

export async function getBulk(db: Db, id: string) {
  const job = (await db.select().from(bulkJobs).where(eq(bulkJobs.id, id)).limit(1))[0];
  if (!job) return null;
  const items = await db
    .select({ id: audits.id, asin: audits.asin, status: audits.status, score: audits.score })
    .from(audits)
    .where(eq(audits.bulkJobId, id))
    .orderBy(asc(audits.createdAt));
  return { job, audits: items };
}

/** Saves the listing version an audit read. The same content twice is one row. */
export async function saveSnapshot(
  db: Db,
  s: { asin: string; source: AuditSource; contentHash: string; fields: unknown; meta: unknown; fetchedAt: Date },
): Promise<void> {
  await db
    .insert(listingSnapshots)
    .values({ ...s, createdAt: new Date() })
    .onDuplicateKeyUpdate({ set: { contentHash: s.contentHash } });
}

export async function addLead(db: Db, l: { email: string; asin: string; auditId: string }): Promise<void> {
  await db.insert(leads).values({ ...l, createdAt: new Date() });
}

export async function leadAuditIds(db: Db, auditIds: string[]): Promise<Set<string>> {
  if (auditIds.length === 0) return new Set();
  const rows = await db.select({ auditId: leads.auditId }).from(leads).where(inArray(leads.auditId, auditIds));
  return new Set(rows.map((r) => r.auditId));
}

export async function leadsFor(db: Db, auditId: string) {
  return db.select().from(leads).where(eq(leads.auditId, auditId));
}

export async function findApiKey(db: Db, hash: string) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1);
  return rows[0] ?? null;
}

/** Adds a key unless one with the same hash exists. Used to seed the dev key. */
export async function ensureApiKey(db: Db, k: { name: string; hash: string; rateLimit?: number }): Promise<void> {
  await db
    .insert(apiKeys)
    .values({ name: k.name, hash: k.hash, rateLimit: k.rateLimit ?? 120, createdAt: new Date() })
    .onDuplicateKeyUpdate({ set: { name: k.name } });
}
