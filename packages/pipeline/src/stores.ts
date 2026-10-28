import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IntentSet, ListingSource, RawListing } from "@answerable/core";
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

export interface ImageFetcher {
  get(url: string): Promise<ImageData | null>;
}

export type FsStoresOptions = {
  /** The fixtures directory: <root>/{serpapi,dataset,intents,image-claims,serpapi-search}. */
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
} {
  const fixtures = {
    serpapi: new FixtureProductData(opts.fixturesDir, "serpapi"),
    dataset: new FixtureProductData(opts.fixturesDir, "dataset"),
  };
  const live = opts.serpApiKey ? new SerpApiProductData({ apiKey: opts.serpApiKey, snapshotDir: join(opts.fixturesDir, "serpapi") }) : null;
  const intentDir = join(opts.fixturesDir, "intents");
  const claimsDir = join(opts.fixturesDir, "image-claims");

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
  };
}
