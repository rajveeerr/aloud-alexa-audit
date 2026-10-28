import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IntentSet, ListingSource, RawListing, ReviewText } from "@answerable/core";
import { FixtureProductData, ImageStore, SerpApiProductData, SerpApiSearch, type ImageData, type SearchResult } from "@answerable/providers";

/** Where listings come from. Snapshots first, a live fetch only when allowed and nothing is saved. */
export interface ListingStore {
  get(source: Exclude<ListingSource, "paste">, asin: string, opts?: { live?: boolean }): Promise<RawListing | null>;
  /** ASINs saved for a source, for offline competitor picking. */
  saved(source: Exclude<ListingSource, "paste">): Promise<string[]>;
}

export interface SearchStore {
  search(query: string): Promise<SearchResult[]>;
}

export interface IntentSetStore {
  all(): Promise<IntentSet[]>;
  save(set: IntentSet, note: string): Promise<void>;
}

/** Saved image transcriptions, so a replay never needs image bytes. */
export interface ImageClaimStore {
  get(source: ListingSource, asin: string): Promise<{ promptVersion: string; modelOutput: unknown } | null>;
  save(source: ListingSource, asin: string, record: { promptVersion: string; modelOutput: unknown; [k: string]: unknown }): Promise<void>;
}

/** A product's saved reviews. `badLines` counts lines that couldn't be read and were skipped. */
export type ReviewSet = { reviews: ReviewText[]; badLines: number };

/**
 * A product's review text, for promise vs proof. Null when there's none: live SerpApi pages don't
 * include review text, and a pasted listing has none.
 */
export interface ReviewStore {
  get(source: ListingSource, asin: string): Promise<ReviewSet | null>;
}

/**
 * Reads saved reviews, one JSON object per line: {r: rating, t: title, x: text, h: helpful votes}.
 * A broken line (a truncated write, a stray character) is skipped and counted, never thrown: one
 * bad review shouldn't cost the product its whole check. A line with neither title nor text is skipped the same way.
 */
export function parseReviewLines(asin: string, text: string): ReviewSet {
  const reviews: ReviewText[] = [];
  let badLines = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let l: { r?: unknown; t?: unknown; x?: unknown; h?: unknown };
    try {
      l = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const title = typeof l?.t === "string" ? l.t : "";
    const body = typeof l?.x === "string" ? l.x : "";
    // A title alone still counts ("Mine broke after barely using it."); nothing at all doesn't.
    if (!title.trim() && !body.trim()) {
      badLines++;
      continue;
    }
    reviews.push({
      asin,
      title,
      text: body,
      helpfulVotes: typeof l.h === "number" ? l.h : 0,
      ...(typeof l.r === "number" && { rating: l.r }),
    });
  }
  return { reviews, badLines };
}

export interface ImageFetcher {
  get(url: string): Promise<ImageData | null>;
}

export type FsStoresOptions = {
  /** The fixtures directory: <root>/{serpapi,dataset,intents,image-claims,serpapi-search,reviews}. */
  fixturesDir: string;
  /** Downloaded image bytes. Keep out of git. */
  imageCacheDir: string;
  /** Needed only for live fetches and searches. */
  serpApiKey?: string;
};

/** File-system stores over the fixtures folder: what the CLI, the tests and the demo API use. */
export function fsStores(opts: FsStoresOptions): {
  listings: ListingStore;
  search: SearchStore | null;
  intentSets: IntentSetStore;
  imageClaims: ImageClaimStore;
  images: ImageFetcher;
  reviews: ReviewStore;
} {
  const fixtures = {
    serpapi: new FixtureProductData(opts.fixturesDir, "serpapi"),
    dataset: new FixtureProductData(opts.fixturesDir, "dataset"),
  };
  const live = opts.serpApiKey ? new SerpApiProductData({ apiKey: opts.serpApiKey, snapshotDir: join(opts.fixturesDir, "serpapi") }) : null;
  const intentDir = join(opts.fixturesDir, "intents");
  const claimsDir = join(opts.fixturesDir, "image-claims");
  const reviewsDir = join(opts.fixturesDir, "reviews");

  return {
    listings: {
      async get(source, asin, o) {
        const saved = await fixtures[source].getListing(asin);
        if (saved || source !== "serpapi" || !o?.live || !live) return saved;
        return live.getListing(asin);
      },
      async saved(source) {
        const files = await readdir(join(opts.fixturesDir, source)).catch(() => [] as string[]);
        return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
      },
    },
    search: opts.serpApiKey ? new SerpApiSearch({ apiKey: opts.serpApiKey, snapshotDir: join(opts.fixturesDir, "serpapi-search") }) : null,
    intentSets: {
      async all() {
        const files = (await readdir(intentDir).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
        return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(intentDir, f), "utf8")) as IntentSet));
      },
      async save(set, note) {
        await mkdir(intentDir, { recursive: true });
        await writeFile(join(intentDir, `${set.categoryId}.json`), JSON.stringify({ ...set, source: note }, null, 2));
      },
    },
    imageClaims: {
      async get(source, asin) {
        return readFile(join(claimsDir, source, `${asin}.json`), "utf8").then(JSON.parse, () => null);
      },
      async save(source, asin, record) {
        await mkdir(join(claimsDir, source), { recursive: true });
        await writeFile(join(claimsDir, source, `${asin}.json`), JSON.stringify({ asin, ...record }, null, 2));
      },
    },
    images: new ImageStore({ cacheDir: opts.imageCacheDir }),
    reviews: {
      // Saved reviews come from the 2023 dataset, so they only belong to dataset listings. A live
      // page of the same ASIN is a different snapshot, years later, and gets none.
      async get(source, asin) {
        if (source !== "dataset") return null;
        const text = await readFile(join(reviewsDir, `${asin}.jsonl`), "utf8").catch(() => null);
        return text === null ? null : parseReviewLines(asin, text);
      },
    },
  };
}
