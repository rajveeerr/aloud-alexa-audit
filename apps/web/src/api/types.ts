import type {
  AsinHistory,
  AuditJob,
  AuditSummary,
  BulkJob,
  CreateAuditBody,
  CreateBulkBody,
  PublicAuditBody,
  PublicAuditResult,
  RescoreBody,
  RescoreResult,
  StudioBriefs,
} from "@answerable/contracts";
import type { z } from "zod";

/** Request bodies as the client sends them: fields with server defaults are optional. */
export type CreateAuditInput = z.input<typeof CreateAuditBody>;
export type CreateBulkInput = z.input<typeof CreateBulkBody>;
export type RescoreInput = z.input<typeof RescoreBody>;
export type PublicAuditInput = z.input<typeof PublicAuditBody>;

export type SavedSource = "serpapi" | "dataset";

/** GET /v1/listings?source=: saved listings for the demo picker. Not in the contracts package yet. */
export type ListingOption = { asin: string; source: SavedSource; brand?: string; title: string; category?: string };

export interface Api {
  readonly mode: "mock" | "http";
  createAudit(body: CreateAuditInput): Promise<AuditJob>;
  getAudit(id: string): Promise<AuditJob>;
  listAudits(limit?: number): Promise<AuditSummary[]>;
  createBriefs(id: string): Promise<StudioBriefs>;
  history(asin: string): Promise<AsinHistory>;
  rescore(body: RescoreInput): Promise<RescoreResult>;
  createBulk(body: CreateBulkInput): Promise<BulkJob>;
  getBulk(id: string): Promise<BulkJob>;
  listBulk(): Promise<BulkJob[]>;
  createPublicAudit(body: PublicAuditInput): Promise<PublicAuditResult>;
  getPublicAudit(id: string): Promise<PublicAuditResult>;
  listings(source: SavedSource): Promise<ListingOption[]>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
