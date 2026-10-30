/**
 * The HTTP contract between apps/api and apps/web (and SalesDuo's own services).
 * Request bodies are zod schemas so the API validates exactly what the client is typed against.
 * Response bodies are plain types; the audit report is the pipeline's AuditResult as JSON.
 */
import { z } from "zod";
import type { AuditResult } from "@aloud/pipeline";

export const Asin = z.string().regex(/^B0[A-Z0-9]{8}$/, "An ASIN is 10 characters starting with B0");

export const PastedListingBody = z.object({
  title: z.string().min(3).max(500),
  bullets: z.array(z.string().max(1000)).max(10).optional(),
  description: z.string().max(5000).optional(),
  attributes: z.record(z.string(), z.string().max(500)).optional(),
  imageUrls: z.array(z.url()).max(16).optional(),
});

/** POST /v1/audits */
export const CreateAuditBody = z
  .object({
    asin: Asin,
    source: z.enum(["serpapi", "dataset", "paste"]).default("serpapi"),
    paste: PastedListingBody.optional(),
    /** Category for a pasted listing, e.g. "Gel Ink Rollerball Pens". */
    category: z.string().max(120).optional(),
    competitors: z.array(Asin).max(6).optional(),
    /** Allow live SerpApi fetches. Costs searches; off by default. */
    live: z.boolean().default(false),
  })
  .refine((b) => b.source !== "paste" || !!b.paste, { message: "source 'paste' needs a paste body", path: ["paste"] });
export type CreateAuditBody = z.infer<typeof CreateAuditBody>;

/** POST /v1/bulk */
export const CreateBulkBody = z.object({
  name: z.string().min(1).max(120),
  asins: z.array(Asin).min(1).max(200),
  source: z.enum(["serpapi", "dataset"]).default("serpapi"),
  live: z.boolean().default(false),
});
export type CreateBulkBody = z.infer<typeof CreateBulkBody>;

/** POST /v1/rescore: the Cohesity webhook. Skipped when the listing's content hash hasn't changed. */
export const RescoreBody = z.object({
  asin: Asin,
  source: z.enum(["serpapi", "dataset"]).default("serpapi"),
  reason: z.string().max(200),
});
export type RescoreBody = z.infer<typeof RescoreBody>;

/** POST /v1/public/audits: the homepage widget. Email is optional; it unlocks the full report. */
export const PublicAuditBody = z.object({
  asin: Asin,
  email: z.email().optional(),
});
export type PublicAuditBody = z.infer<typeof PublicAuditBody>;

/** POST /v1/public/audits/:id/email: leave an email for a widget audit that's already running or done. */
export const PublicEmailBody = z.object({ email: z.email() });
export type PublicEmailBody = z.infer<typeof PublicEmailBody>;

export type AuditStatus = "queued" | "running" | "done" | "failed";
export type AuditOrigin = "app" | "api" | "widget" | "rescore" | "bulk";

/** GET /v1/audits/:id */
export type AuditJob = {
  id: string;
  asin: string;
  source: "serpapi" | "dataset" | "paste";
  origin: AuditOrigin;
  status: AuditStatus;
  /** Set when status is "failed". */
  error?: { code: string; message: string };
  createdAt: string;
  completedAt?: string;
  score?: number | null;
  contentHash?: string;
  /** Why a queued audit is waiting, e.g. for the model's daily quota to reset or for a retry. */
  note?: string;
  /** Present when status is "done". */
  report?: AuditReport;
};

export type AuditReport = AuditResult;

/** POST /v1/audits response (202). Poll GET /v1/audits/:id for the rest. */
export type AuditCreated = Pick<AuditJob, "id" | "status">;

/** GET /v1/audits?limit= */
export type AuditSummary = Pick<AuditJob, "id" | "asin" | "source" | "origin" | "status" | "createdAt" | "completedAt" | "score"> & {
  brand?: string;
  title?: string;
  category?: string;
};

/** POST /v1/audits/:id/briefs: Studio-ready briefs. */
export type StudioBriefs = {
  auditId: string;
  asin: string;
  category: string;
  briefs: AuditReport["briefs"];
};

/** GET /v1/asins/:asin/history: the BI dashboard tile. */
export type HistoryPoint = { auditId: string; at: string; score: number | null; contentHash: string; origin: AuditOrigin };
export type AsinHistory = { asin: string; points: HistoryPoint[] };

/** POST /v1/rescore response. */
export type RescoreResult = { skipped: true; reason: "unchanged"; auditId: string } | { skipped: false; auditId: string };

/** POST /v1/bulk response (202). */
export type BulkCreated = { id: string };

/** GET /v1/bulk/:id */
export type BulkJob = {
  id: string;
  name: string;
  status: "running" | "done";
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  audits: { id: string; asin: string; status: AuditStatus; score: number | null }[];
};

/** Each item of GET /v1/bulk?limit= (newest first): progress without the per-audit rows. */
export type BulkSummary = Omit<BulkJob, "audits">;

/** POST /v1/public/audits response, once done: the top 3 gaps only, the full report goes by email. */
export type PublicAuditResult = {
  id: string;
  status: AuditStatus;
  asin: string;
  score?: number | null;
  scoreBasis?: "mined" | "estimated";
  topGaps?: {
    question: string;
    status: string;
    /** Answered counts 1, partial 0.5. For ranking; show shoppers the counts below. */
    competitorShare: number | null;
    /** Competitors that answer it, fully or partly. */
    competitorsAnswering: number;
    /** Competitors the question applies to. */
    competitors: number;
    hiddenInImage: boolean;
  }[];
  emailCaptured: boolean;
  /** When status is "failed": a short reason that's safe to show a visitor. */
  reason?: string;
};

/** GET /v1/listings?source=: saved listings the UI can offer as demo products. */
export const ListingsQuery = z.object({ source: z.enum(["serpapi", "dataset"]).optional() });
export type SavedListing = { asin: string; source: "serpapi" | "dataset"; brand?: string; title: string; category?: string };

/** GET /v1/health. 503 when either dependency is down. */
export type Health = { ok: boolean; db: boolean; redis: boolean };

/** Every error response. */
export type ApiError = { error: { code: string; message: string; details?: unknown } };
