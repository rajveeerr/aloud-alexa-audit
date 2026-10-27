import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRetryableStatus, withRetry, type RetryOptions } from "../retry";
import { ProviderError, type ProductDataProvider, type RawListing } from "../types";
import { fetchWithTimeout } from "../timeout";

const ENDPOINT = "https://serpapi.com/search.json";

// Blocks about other products. Dropped so snapshots hold only this listing.
const DROP_KEYS = [
  "search_metadata",
  "search_parameters",
  "related_products",
  "related_product_sections",
  "sponsored_brands",
  "bought_together",
  "videos",
];

export type SerpApiOptions = {
  apiKey: string;
  domain?: string;
  /** When set, every successful response is also written to `<dir>/<asin>.json`. */
  snapshotDir?: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
};

/** Live listings through SerpApi's amazon_product engine. Free plan: 250 searches a month. */
export class SerpApiProductData implements ProductDataProvider {
  readonly name = "serpapi";
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: SerpApiOptions) {
    if (!opts.apiKey) throw new Error("SerpApi key is missing");
    this.fetch = opts.fetch ?? fetch;
  }

  async getListing(asin: string): Promise<RawListing | null> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("engine", "amazon_product");
    url.searchParams.set("asin", asin);
    url.searchParams.set("amazon_domain", this.opts.domain ?? "amazon.com");
    url.searchParams.set("api_key", this.opts.apiKey);

    const body = await withRetry(async () => {
      const res = await fetchWithTimeout(this.fetch, url, {}, 60_000).catch((err: Error) => {
        throw new ProviderError(`Request failed: ${err.message}`, "serpapi", undefined, true);
      });
      if (!res.ok) {
        throw new ProviderError(`SerpApi returned ${res.status}`, this.name, res.status, isRetryableStatus(res.status));
      }
      return (await res.json()) as Record<string, unknown>;
    }, this.opts.retry);

    if (typeof body.error === "string") {
      if (/hasn't returned any results|no results/i.test(body.error)) return null;
      throw new ProviderError(`SerpApi: ${body.error}`, this.name);
    }
    // Keep just the ASINs of related products: a fallback list of competitors that costs no
    // extra search when Amazon search returns nothing.
    const related = Array.isArray(body.related_products) ? (body.related_products as { asin?: unknown }[]) : [];
    body.related_asins = [...new Set(related.map((r) => r.asin).filter((a): a is string => typeof a === "string" && a !== asin))];
    for (const key of DROP_KEYS) delete body[key];

    if (this.opts.snapshotDir) {
      await mkdir(this.opts.snapshotDir, { recursive: true });
      await writeFile(join(this.opts.snapshotDir, `${asin}.json`), JSON.stringify(body, null, 2));
    }

    return { source: "serpapi", requestedAsin: asin, fetchedAt: new Date().toISOString(), data: body };
  }
}
