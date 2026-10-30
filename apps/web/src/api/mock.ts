/**
 * The API, faked in the browser over reports the real pipeline produced (scripts/make-mocks.ts).
 * Jobs move queued → running → done on a timer so the progress states are visible.
 */
import type { AuditJob, AuditReport, AuditStatus, AuditSummary, BulkJob, PublicAuditResult, SavedListing } from "@aloud/contracts";
import { competitorCounts } from "@/lib/report";
import index from "../mocks/listings.json";
import type { PublicApi } from "./public";
import { ApiRequestError, type Api, type SavedSource } from "./types";

type Indexed = SavedListing & { score: number | null; contentHash: string };
const LISTINGS = index as Indexed[];

const loaders = import.meta.glob<AuditReport>("../mocks/reports/*.json", { import: "default" });
const reports = new Map<string, Promise<AuditReport>>();

function loadReport(key: string): Promise<AuditReport> {
  let p = reports.get(key);
  if (!p) {
    const load = loaders[`../mocks/reports/${key}.json`];
    if (!load) throw new Error(`No mock report ${key}`);
    p = load();
    reports.set(key, p);
  }
  return p;
}

const QUEUED_MS = 500;
const DONE_MS = 2000;
const STORE_KEY = "aloud.mock.v2";

type MockJob = {
  id: string;
  asin: string;
  source: AuditJob["source"];
  origin: AuditJob["origin"];
  createdAt: string;
  /** Milliseconds after creation when the job finishes. */
  finishMs: number;
  /** `${source}-${asin}` of the saved report, or null when the job fails. */
  key: string | null;
  error?: { code: string; message: string };
  email?: string;
};
type MockBulk = { id: string; name: string; createdAt: string; auditIds: string[] };
type State = { jobs: MockJob[]; bulks: MockBulk[] };

function seed(): State {
  const now = Date.now();
  const jobs: MockJob[] = LISTINGS.map((l, i) => ({
    id: `demo-${l.source}-${l.asin.toLowerCase()}`,
    asin: l.asin,
    source: l.source,
    origin: "app",
    createdAt: new Date(now - (i + 1) * 3_600_000 * 5).toISOString(),
    finishMs: 41_000,
    key: `${l.source}-${l.asin}`,
  }));
  return { jobs, bulks: [] };
}

function load(): State {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    // Storage can be unavailable (private mode); fall back to memory.
  }
  return seed();
}

const state = load();
function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Ignore: state still lives in memory.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => sleep(120 + Math.random() * 120);
const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

function statusOf(job: MockJob): AuditStatus {
  const elapsed = Date.now() - Date.parse(job.createdAt);
  if (elapsed < QUEUED_MS) return "queued";
  if (elapsed < job.finishMs) return "running";
  return job.key ? "done" : "failed";
}

function find(source: AuditJob["source"], asin: string): Indexed | undefined {
  return LISTINGS.find((l) => l.source === source && l.asin === asin);
}

function makeJob(asin: string, source: AuditJob["source"], origin: AuditJob["origin"], finishMs = DONE_MS): MockJob {
  const hit = source === "paste" ? undefined : find(source, asin);
  const job: MockJob = { id: newId("aud"), asin, source, origin, createdAt: new Date().toISOString(), finishMs, key: hit ? `${hit.source}-${hit.asin}` : null };
  if (!hit) {
    job.error =
      source === "paste"
        ? { code: "mock_mode", message: "Demo mode can't grade a pasted listing. Start the API to audit pasted text." }
        : { code: "listing_not_found", message: `Demo mode has no saved ${source === "serpapi" ? "live" : "dataset"} report for ${asin}. Start the API to audit it.` };
  }
  state.jobs.unshift(job);
  save();
  return job;
}

function getJob(id: string): MockJob {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) throw new ApiRequestError(`No audit with id ${id}`, "not_found", 404);
  return job;
}

async function toJob(job: MockJob): Promise<AuditJob> {
  const status = statusOf(job);
  const out: AuditJob = { id: job.id, asin: job.asin, source: job.source, origin: job.origin, status, createdAt: job.createdAt };
  if (status === "failed" && job.error) out.error = job.error;
  if (status === "done" && job.key) {
    const report = await loadReport(job.key);
    out.report = report;
    out.score = report.score.score;
    out.contentHash = report.listing.contentHash;
    out.completedAt = new Date(Date.parse(job.createdAt) + job.finishMs).toISOString();
  }
  return out;
}

function toSummary(job: MockJob): AuditSummary {
  const status = statusOf(job);
  const hit = job.source === "paste" ? undefined : find(job.source, job.asin);
  const out: AuditSummary = { id: job.id, asin: job.asin, source: job.source, origin: job.origin, status, createdAt: job.createdAt };
  if (hit) {
    out.title = hit.title;
    out.category = hit.category ?? "";
    if (hit.brand) out.brand = hit.brand;
  }
  if (status === "done") {
    out.score = hit?.score ?? null;
    out.completedAt = new Date(Date.parse(job.createdAt) + job.finishMs).toISOString();
  }
  return out;
}

function toBulk(b: MockBulk): BulkJob {
  const audits = b.auditIds.map((id) => {
    const j = getJob(id);
    const status = statusOf(j);
    return { id, asin: j.asin, status, score: status === "done" ? (find(j.source, j.asin)?.score ?? null) : null };
  });
  const done = audits.filter((a) => a.status === "done").length;
  const failed = audits.filter((a) => a.status === "failed").length;
  return { id: b.id, name: b.name, status: done + failed === audits.length ? "done" : "running", total: audits.length, done, failed, createdAt: b.createdAt, audits };
}

async function toPublic(job: MockJob): Promise<PublicAuditResult> {
  const status = statusOf(job);
  const out: PublicAuditResult = { id: job.id, status, asin: job.asin, emailCaptured: !!job.email };
  if (status === "failed") out.reason = "We can't audit this product yet. Try one of the example products.";
  if (status === "done" && job.key) {
    const r = await loadReport(job.key);
    const questions = new Map(r.intentSet.intents.map((i) => [i.id, i.question]));
    out.score = r.score.score;
    out.scoreBasis = r.intentSet.basis;
    out.topGaps = r.gaps.slice(0, 3).map((g) => ({
      question: questions.get(g.intentId) ?? g.intentId,
      status: g.status,
      competitorShare: g.competitorShare,
      ...competitorCounts(r, g.intentId),
      hiddenInImage: g.hiddenClaims.length > 0,
    }));
  }
  return out;
}

/** Both clients in one: the app and the widget share the mock state, as they share the real API. */
export function mockApi(): Api & PublicApi {
  return {
    mode: "mock",
    async createAudit(body) {
      await latency();
      const job = makeJob(body.asin, body.source ?? "serpapi", "app");
      return { id: job.id, status: statusOf(job) };
    },
    async getAudit(id) {
      await latency();
      return toJob(getJob(id));
    },
    async listAudits(limit = 50) {
      await latency();
      return state.jobs.filter((j) => j.origin !== "widget").slice(0, limit).map(toSummary);
    },
    async createBriefs(id) {
      await latency();
      const job = getJob(id);
      if (statusOf(job) !== "done" || !job.key) throw new ApiRequestError("The audit isn't finished yet", "not_ready", 409);
      const r = await loadReport(job.key);
      return { auditId: id, asin: r.listing.asin, category: r.intentSet.categoryName, briefs: r.briefs };
    },
    async history(asin) {
      await latency();
      const hit = LISTINGS.find((l) => l.asin === asin);
      const score = hit?.score ?? 52;
      const day = 86_400_000;
      const now = Date.now();
      // Three made-up points ending at the saved score, so the chart has a shape.
      const scores = [Math.max(0, score - 13), Math.max(0, score - 6), score];
      return {
        asin,
        points: scores.map((s, i) => ({
          auditId: i === 2 && hit ? `demo-${hit.source}-${asin.toLowerCase()}` : `aud_hist${i}`,
          at: new Date(now - (2 - i) * 14 * day).toISOString(),
          score: s,
          contentHash: i === 2 ? (hit?.contentHash ?? "") : `prior${i}`,
          origin: i === 0 ? "app" : "rescore",
        })),
      };
    },
    async rescore(body) {
      await latency();
      const existing = state.jobs.find((j) => j.asin === body.asin && j.key);
      if (existing) return { skipped: true, reason: "unchanged", auditId: existing.id };
      return { skipped: false, auditId: makeJob(body.asin, body.source ?? "serpapi", "rescore").id };
    },
    async createBulk(body) {
      await latency();
      const source = body.source ?? "serpapi";
      // Stagger finishes so the table fills in row by row.
      const ids = body.asins.map((asin, i) => makeJob(asin, source, "bulk", 1200 + i * 900).id);
      const bulk: MockBulk = { id: newId("blk"), name: body.name, createdAt: new Date().toISOString(), auditIds: ids };
      state.bulks.unshift(bulk);
      save();
      return { id: bulk.id };
    },
    async getBulk(id) {
      await latency();
      const b = state.bulks.find((x) => x.id === id);
      if (!b) throw new ApiRequestError(`No bulk job with id ${id}`, "not_found", 404);
      return toBulk(b);
    },
    async listBulk(limit = 10) {
      await latency();
      return state.bulks.slice(0, limit).map((b) => {
        const { audits: _, ...summary } = toBulk(b);
        return summary;
      });
    },
    async createPublicAudit(body) {
      await latency();
      const job = makeJob(body.asin, "serpapi", "widget");
      // The widget audits any saved listing, whichever source it was saved from.
      const any = LISTINGS.find((l) => l.asin === body.asin);
      if (any) {
        job.key = `${any.source}-${any.asin}`;
        job.source = any.source;
        delete job.error;
      }
      if (body.email) job.email = body.email;
      save();
      return toPublic(job);
    },
    async getPublicAudit(id) {
      await latency();
      return toPublic(getJob(id));
    },
    async addPublicEmail(id, email) {
      await latency();
      const job = getJob(id);
      if (job.origin !== "widget") throw new ApiRequestError("No such audit", "not_found", 404);
      job.email = email;
      save();
      return toPublic(job);
    },
    async listings(source: SavedSource) {
      await latency();
      return LISTINGS.filter((l) => l.source === source).map(({ asin, source: s, brand, title, category }): SavedListing => ({
        asin,
        source: s,
        title,
        ...(brand && { brand }),
        ...(category && { category }),
      }));
    },
  };
}
