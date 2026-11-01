import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRetryableStatus, withRetry, type RetryOptions } from "../retry";
import { ProviderError } from "../types";
import { fetchWithTimeout } from "../timeout";

/** Same shape as core's ReviewText. The product key is "wm:<us_item_id>" so it can't clash with an ASIN. */
export type WalmartReview = { asin: string; title: string; text: string; helpfulVotes: number; rating?: number };

export type WalmartReviewSet = {
  query: string;
  fetchedAt: string;
  products: { usItemId: string; title: string; reviewCount: number }[];
  reviews: WalmartReview[];
};

export type WalmartReviewsOptions = {
  /** Without a key, only saved review sets can be read. */
  apiKey?: string;
  /** Each query's reviews are saved as <dir>/<slug>.json and reused, so a category is fetched once. */
  snapshotDir?: string;
  /** How many products to read reviews from (the most-reviewed ones first). */
  products?: number;
  /** Pages of reviews per product; one page is 20 reviews and costs one search. */
  pages?: number;
  fetch?: typeof fetch;
  retry?: RetryOptions;
};

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Real shopper reviews for a product type, from Walmart through SerpApi. Amazon's review pages sit
 * behind a login and scraping them breaks Amazon's terms; Walmart's reviews come through SerpApi's
 * API with full text. A question set describes a product type, not one listing, so reviews of the
 * same kind of product from another store are what's needed.
 *
 * Cost: 1 search + `products` × `pages` review pages. Defaults: 1 + 5 × 2 = 11 searches for about 200
 * reviews. Saved after the first fetch, so later audits in the category cost nothing.
 */
export class WalmartReviews {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: WalmartReviewsOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  /** Saved reviews for the query, or fetched ones when there's a key. Null when neither. */
  async forQuery(query: string): Promise<WalmartReviewSet | null> {
    const path = this.opts.snapshotDir ? join(this.opts.snapshotDir, `${slug(query)}.json`) : null;
    const saved = path ? await readFile(path, "utf8").then((t) => JSON.parse(t) as WalmartReviewSet, () => null) : null;
    if (saved) return saved;
    if (!this.opts.apiKey) return null;

    const search = await this.request({ engine: "walmart", query });
    const rows = Array.isArray(search.organic_results) ? (search.organic_results as Record<string, unknown>[]) : [];
    // Most-reviewed first: those have the most to read, and they're what shoppers of this type buy.
    const products = rows
      .filter((r) => r.sponsored !== true && typeof r.us_item_id === "string" && typeof r.reviews === "number" && (r.reviews as number) >= 5)
      .sort((a, b) => (b.reviews as number) - (a.reviews as number))
      .slice(0, this.opts.products ?? 5)
      .map((r) => ({ usItemId: r.us_item_id as string, title: typeof r.title === "string" ? r.title : "", reviewCount: r.reviews as number }));

    const reviews: WalmartReview[] = [];
    for (const p of products) {
      for (let page = 1; page <= (this.opts.pages ?? 2); page++) {
        const body = await this.request({ engine: "walmart_product_reviews", product_id: p.usItemId, page: String(page) });
        const rows = Array.isArray(body.reviews) ? (body.reviews as Record<string, unknown>[]) : [];
        for (const r of rows) {
          const text = typeof r.text === "string" ? r.text.trim() : "";
          if (!text) continue;
          reviews.push({
            asin: `wm:${p.usItemId}`,
            title: typeof r.title === "string" ? r.title : "",
            text,
            helpfulVotes: typeof r.positive_feedback === "number" ? r.positive_feedback : 0,
            ...(typeof r.rating === "number" && { rating: r.rating }),
          });
        }
        if (rows.length < 20) break;
      }
    }

    const set: WalmartReviewSet = { query, fetchedAt: new Date().toISOString(), products, reviews };
    // An empty set is often a temporary block, so it isn't saved; the next audit tries again.
    if (path && reviews.length > 0) {
      await mkdir(this.opts.snapshotDir!, { recursive: true });
      await writeFile(path, JSON.stringify(set, null, 2));
    }
    return set;
  }

  private async request(params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL("https://serpapi.com/search.json");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("api_key", this.opts.apiKey!);
    const body = await withRetry(async () => {
      const res = await fetchWithTimeout(this.fetch, url, {}, 60_000).catch((err: Error) => {
        throw new ProviderError(`Request failed: ${err.message}`, "serpapi", undefined, true);
      });
      if (!res.ok) throw new ProviderError(`SerpApi returned ${res.status}`, "serpapi", res.status, isRetryableStatus(res.status));
      return (await res.json()) as Record<string, unknown>;
    }, this.opts.retry);
    // "No results" and "no reviews" are answers, not failures; a bad key or spent quota is an error.
    if (typeof body.error === "string" && !/no results|hasn't returned any results|has no reviews/i.test(body.error)) {
      throw new ProviderError(`SerpApi: ${body.error}`, "serpapi");
    }
    return body;
  }
}
