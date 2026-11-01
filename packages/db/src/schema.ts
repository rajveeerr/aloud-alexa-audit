import { datetime, index, int, json, mysqlEnum, mysqlTable, serial, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Millisecond precision so two audits created in the same second still sort. */
const at = (name: string) => datetime(name, { mode: "date", fsp: 3 });

export const SOURCES = ["serpapi", "dataset", "paste"] as const;
export const ORIGINS = ["app", "api", "widget", "rescore", "bulk"] as const;
export const STATUSES = ["queued", "running", "done", "failed"] as const;

/**
 * Every listing version an audit actually read. Unique per content hash, so an unchanged
 * listing is stored once however many times it's audited.
 */
export const listingSnapshots = mysqlTable(
  "listing_snapshots",
  {
    id: serial("id").primaryKey(),
    asin: varchar("asin", { length: 16 }).notNull(),
    source: mysqlEnum("source", SOURCES).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    fields: json("fields").notNull(),
    meta: json("meta").notNull(),
    fetchedAt: at("fetched_at").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [uniqueIndex("listing_snapshots_hash").on(t.source, t.asin, t.contentHash)],
);

export const bulkJobs = mysqlTable("bulk_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  source: mysqlEnum("source", SOURCES).notNull(),
  total: int("total").notNull(),
  createdAt: at("created_at").notNull(),
});

/**
 * One audit request and, once done, its whole report. `asin` is what was asked for until the
 * audit runs, then the ASIN the page actually showed (variants can differ); `requested_asin`
 * always keeps the original so history finds both.
 */
export const audits = mysqlTable(
  "audits",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    asin: varchar("asin", { length: 16 }).notNull(),
    requestedAsin: varchar("requested_asin", { length: 16 }).notNull(),
    source: mysqlEnum("source", SOURCES).notNull(),
    origin: mysqlEnum("origin", ORIGINS).notNull(),
    status: mysqlEnum("status", STATUSES).notNull(),
    /** What runAudit needs beyond asin and source: competitors, maxCompetitors, live, paste, category. */
    request: json("request").notNull(),
    score: int("score"),
    basis: mysqlEnum("basis", ["mined", "insights", "estimated"]),
    categoryId: varchar("category_id", { length: 120 }),
    /** Copied out of the report so lists don't have to load every report. */
    categoryName: varchar("category_name", { length: 200 }),
    brand: varchar("brand", { length: 200 }),
    title: text("title"),
    contentHash: varchar("content_hash", { length: 64 }),
    report: json("report"),
    usage: json("usage"),
    error: json("error"),
    /** Why a queued audit is waiting, e.g. the model's daily quota ran out. */
    note: text("note"),
    bulkJobId: varchar("bulk_job_id", { length: 36 }),
    createdAt: at("created_at").notNull(),
    startedAt: at("started_at"),
    completedAt: at("completed_at"),
  },
  (t) => [
    index("audits_asin_created").on(t.asin, t.createdAt),
    index("audits_requested_created").on(t.requestedAsin, t.createdAt),
    index("audits_status").on(t.status),
    index("audits_bulk").on(t.bulkJobId),
  ],
);

export const leads = mysqlTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    asin: varchar("asin", { length: 16 }).notNull(),
    auditId: varchar("audit_id", { length: 36 }).notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("leads_audit").on(t.auditId)],
);

/** Only the SHA-256 of a key is stored, so a leaked table doesn't leak keys. */
export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    hash: varchar("hash", { length: 64 }).notNull(),
    /** Requests per minute. */
    rateLimit: int("rate_limit").notNull().default(120),
    createdAt: at("created_at").notNull(),
  },
  (t) => [uniqueIndex("api_keys_hash").on(t.hash)],
);

export type AuditRow = typeof audits.$inferSelect;
export type BulkJobRow = typeof bulkJobs.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type AuditSource = (typeof SOURCES)[number];
export type AuditOriginValue = (typeof ORIGINS)[number];
export type AuditStatusValue = (typeof STATUSES)[number];

/**
 * Question sets built in production (mined from store reviews, built from review topics, or
 * estimated). The server's disk is wiped when a free instance sleeps, so they live here instead,
 * and a category is mined once. Curated sets stay in fixtures/intents in the repo.
 */
export const questionSets = mysqlTable("question_sets", {
  categoryId: varchar("category_id", { length: 120 }).primaryKey(),
  basis: mysqlEnum("basis", ["mined", "insights", "estimated"]).notNull(),
  set: json("set").notNull(),
  note: text("note").notNull(),
  updatedAt: at("updated_at").notNull(),
});
