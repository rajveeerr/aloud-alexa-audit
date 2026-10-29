import type {
  AsinHistory,
  AuditCreated,
  AuditJob,
  AuditSummary,
  BulkCreated,
  BulkJob,
  BulkSummary,
  CreateAuditBody,
  CreateBulkBody,
  PublicAuditBody,
  RescoreBody,
  RescoreResult,
  SavedListing,
  StudioBriefs,
} from "@answerable/contracts";
import type { z } from "zod";

/** Request bodies as the client sends them: fields with server defaults are optional. */
export type CreateAuditInput = z.input<typeof CreateAuditBody>;
export type CreateBulkInput = z.input<typeof CreateBulkBody>;
export type RescoreInput = z.input<typeof RescoreBody>;
export type PublicAuditInput = z.input<typeof PublicAuditBody>;

export type SavedSource = SavedListing["source"];

/** The internal app's client: every keyed endpoint. The widget uses PublicApi (public.ts) instead. */
export interface Api {
  readonly mode: "mock" | "http";
  createAudit(body: CreateAuditInput): Promise<AuditCreated>;
  getAudit(id: string): Promise<AuditJob>;
  listAudits(limit?: number): Promise<AuditSummary[]>;
  createBriefs(id: string): Promise<StudioBriefs>;
  history(asin: string): Promise<AsinHistory>;
  rescore(body: RescoreInput): Promise<RescoreResult>;
  createBulk(body: CreateBulkInput): Promise<BulkCreated>;
  getBulk(id: string): Promise<BulkJob>;
  listBulk(limit?: number): Promise<BulkSummary[]>;
  listings(source: SavedSource): Promise<SavedListing[]>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** 0 when the API couldn't be reached at all. */
    readonly status: number,
    /** From Retry-After on a 429 or 503. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
