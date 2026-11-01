import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalmartReviews } from "./walmart";

/** A fake SerpApi: a Walmart search with three products, then 20 or 3 reviews per product. */
function fakeSerpApi() {
  const calls: string[] = [];
  const fetchFn = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get("engine") + ":" + (url.searchParams.get("product_id") ?? url.searchParams.get("query")));
    if (url.searchParams.get("engine") === "walmart") {
      return Response.json({
        organic_results: [
          { us_item_id: "111", title: "Few reviews", reviews: 3 },
          { us_item_id: "222", title: "Popular cloths", reviews: 900 },
          { us_item_id: "333", title: "Some cloths", reviews: 40, sponsored: true },
          { us_item_id: "444", title: "Other cloths", reviews: 120 },
        ],
      });
    }
    const id = url.searchParams.get("product_id");
    const n = id === "222" ? 20 : 3;
    return Response.json({ reviews: Array.from({ length: n }, (_, i) => ({ title: `t${i}`, text: `review ${id} ${i}`, rating: 5, positive_feedback: i })) });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("WalmartReviews", () => {
  test("reads the most-reviewed unsponsored products, skips tiny ones, and saves the set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wm-"));
    const { calls, fetchFn } = fakeSerpApi();
    const wm = new WalmartReviews({ apiKey: "k", snapshotDir: dir, fetch: fetchFn, products: 4, pages: 2 });
    const set = await wm.forQuery("Cleaning Cloths");
    expect(set!.products.map((p) => p.usItemId)).toEqual(["222", "444"]);
    // 222 has a full first page, so its second page is read; 444's first page is short, so it stops.
    expect(calls).toEqual(["walmart:Cleaning Cloths", "walmart_product_reviews:222", "walmart_product_reviews:222", "walmart_product_reviews:444"]);
    expect(set!.reviews[0]).toMatchObject({ asin: "wm:222", text: "review 222 0", rating: 5 });
    expect(readdirSync(dir)).toEqual(["cleaning-cloths.json"]);

    // Saved: the same query again costs nothing, even without a key.
    const offline = new WalmartReviews({ snapshotDir: dir, fetch: (() => { throw new Error("no network") }) as unknown as typeof fetch });
    expect((await offline.forQuery("Cleaning Cloths"))!.reviews.length).toBe(set!.reviews.length);
  });

  test("without a key and nothing saved, it returns null and makes no calls", async () => {
    const { calls, fetchFn } = fakeSerpApi();
    expect(await new WalmartReviews({ snapshotDir: mkdtempSync(join(tmpdir(), "wm-")), fetch: fetchFn }).forQuery("x")).toBeNull();
    expect(calls).toEqual([]);
  });
});
