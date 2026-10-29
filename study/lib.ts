import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

export const STUDY = import.meta.dir;
export const ROOT = join(STUDY, "..");
export const MODEL = "gemini-3.5-flash-lite";
export const SEED = "answerable-study-1";

/** Where the raw dataset lives. `--data <dir>` overrides the default of <repo>/data/raw. */
export function dataDir(args: string[]): string {
  const i = args.indexOf("--data");
  const dir = i >= 0 ? args[i + 1] : undefined;
  return dir ?? join(ROOT, "data/raw");
}

export async function* jsonl<T>(path: string): AsyncGenerator<T> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (line.trim()) yield JSON.parse(line) as T;
  }
}

/** Deterministic order key: sha256 of seed + id. */
export function seededKey(id: string, seed = SEED): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

/** Small seeded PRNG (mulberry32), so bootstrap and permutation results repeat exactly. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SampleRow = {
  asin: string;
  /** Demand band 1 (fewest reviews) to 4 (most). */
  band: number;
  rating_number: number;
  average_rating: number | null;
  price: number | null;
  /** Office Products sales rank from the record's details, when it has one (snapshot, 2023). */
  salesRank: number | null;
  store: string | null;
  title: string;
};

export type Sample = {
  seed: string;
  /** Products left after the filters, before sampling. */
  pool: number;
  excludedMiningProducts: number;
  /** log10(rating_number) cut points between the four bands. */
  bandCuts: number[];
  products: SampleRow[];
};

export type ScoreRow = {
  asin: string;
  band: number;
  score: number | null;
  answered: number;
  partial: number;
  missing: number;
  contradicted: number;
  notApplicable: number;
  counted: number;
  contentHash: string;
  /** Status per question id, spec and claim questions only. */
  statuses: Record<string, string>;
};

export type Scores = {
  model: string;
  intentSetVersion: string;
  graded: number;
  /** ASINs with no recording yet. */
  pending: string[];
  products: ScoreRow[];
};
