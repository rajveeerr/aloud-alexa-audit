import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRetryableStatus, withRetry, type RetryOptions } from "../retry";
import { ProviderError } from "../types";
import { fetchWithTimeout } from "../timeout";

export type SearchResult = { asin: string; title: string; sponsored: boolean; reviews: number; position: number };

export type SerpApiSearchOptions = {
  apiKey: string;
  domain?: string;
  /** Results are saved as <dir>/<slug>.json and reused, so a repeat search costs nothing. */
  snapshotDir?: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
};

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Amazon search results through SerpApi's amazon engine. One call is one of the 250 monthly searches. */
export class SerpApiSearch {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: SerpApiSearchOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  async search(query: string): Promise<SearchResult[]> {
    const path = this.opts.snapshotDir ? join(this.opts.snapshotDir, `${slug(query)}.json`) : null;
    const saved = path ? await readFile(path, "utf8").then((t) => JSON.parse(t) as Record<string, unknown>, () => null) : null;
    const body = saved ?? (await this.request(query));
    // Don't save an empty answer: it's often a temporary block, and saving it would stick.
    if (path && !saved && Array.isArray(body.organic_results) && body.organic_results.length > 0) {
      await mkdir(this.opts.snapshotDir!, { recursive: true });
      await writeFile(path, JSON.stringify(body, null, 2));
    }

    const rows = Array.isArray(body.organic_results) ? (body.organic_results as Record<string, unknown>[]) : [];
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const r of rows) {
      const asin = typeof r.asin === "string" ? r.asin : "";
      if (!asin || seen.has(asin)) continue;
      seen.add(asin);
      results.push({
        asin,
        title: typeof r.title === "string" ? r.title : "",
        sponsored: r.sponsored === true,
        reviews: typeof r.reviews === "number" ? r.reviews : 0,
        position: results.length + 1,
      });
    }
    return results;
  }

  private async request(query: string): Promise<Record<string, unknown>> {
    if (!this.opts.apiKey) throw new Error("SerpApi key is missing");
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "amazon");
    url.searchParams.set("k", query);
    url.searchParams.set("amazon_domain", this.opts.domain ?? "amazon.com");
    url.searchParams.set("api_key", this.opts.apiKey);
    const body = await withRetry(async () => {
      const res = await fetchWithTimeout(this.fetch, url, {}, 60_000).catch((err: Error) => {
        throw new ProviderError(`Request failed: ${err.message}`, "serpapi", undefined, true);
      });
      if (!res.ok) throw new ProviderError(`SerpApi returned ${res.status}`, "serpapi", res.status, isRetryableStatus(res.status));
      return (await res.json()) as Record<string, unknown>;
    }, this.opts.retry);
    // "no results" is an answer, not a failure; anything else (bad key, quota) is an error.
    if (typeof body.error === "string" && !/hasn't returned any results|no results/i.test(body.error)) {
      throw new ProviderError(`SerpApi: ${body.error}`, "serpapi");
    }
    delete body.search_metadata;
    delete body.search_parameters;
    return body;
  }
}

/**
 * Competitors are the top organic results: what a shopper actually sees first. Sponsored
 * results are left out (they're bought placement), and so is the audited product itself.
 */
export function pickCompetitors(results: SearchResult[], exclude: string[], count = 4): string[] {
  const skip = new Set(exclude);
  return results.filter((r) => !r.sponsored && !skip.has(r.asin)).slice(0, count).map((r) => r.asin);
}
