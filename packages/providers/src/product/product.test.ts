import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatasetProductData } from "./dataset";
import { FixtureProductData } from "./fixtures";
import { SerpApiProductData } from "./serpapi";

const FIXTURES = join(import.meta.dir, "../../../../fixtures");
const noSleep = { sleep: async () => {} };

describe("FixtureProductData", () => {
  test("loads a recorded live listing", async () => {
    const listing = await new FixtureProductData(FIXTURES, "serpapi").getListing("B0C9W8DD9S");
    expect(listing?.source).toBe("serpapi");
    expect(listing?.requestedAsin).toBe("B0C9W8DD9S");
    expect((listing?.data as { product_results: { asin: string } }).product_results.asin).toBe("B0C9W8DD9S");
  });

  test("loads a dataset listing", async () => {
    const listing = await new FixtureProductData(FIXTURES, "dataset").getListing("B08CMWPFR1");
    expect((listing?.data as { parent_asin: string }).parent_asin).toBe("B08CMWPFR1");
  });

  test("returns null for an unknown ASIN", async () => {
    expect(await new FixtureProductData(FIXTURES, "serpapi").getListing("B000000000")).toBeNull();
  });
});

describe("DatasetProductData", () => {
  test("indexes a JSONL file by parent_asin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dataset-"));
    const path = join(dir, "meta.jsonl");
    await writeFile(path, ['{"parent_asin":"A1","title":"one"}', "", '{"parent_asin":"A2","title":"two"}'].join("\n"));
    const provider = new DatasetProductData(path);
    expect((await provider.getListing("A2"))?.data).toEqual({ parent_asin: "A2", title: "two" });
    expect(await provider.getListing("A3")).toBeNull();
    expect(await provider.asins()).toEqual(["A1", "A2"]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("SerpApiProductData", () => {
  const body = {
    search_metadata: { id: "x" },
    search_parameters: { asin: "B0TEST" },
    product_results: { asin: "B0TEST", title: "Pen" },
    related_products: [{ asin: "OTHER" }],
    about_item: ["bullet"],
  };

  test("builds the request, strips other-product blocks and snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serpapi-"));
    let requested = "";
    const fetch = (async (url: string | URL | Request) => {
      requested = String(url);
      return new Response(JSON.stringify(body));
    }) as typeof globalThis.fetch;

    const listing = await new SerpApiProductData({ apiKey: "secret", fetch, snapshotDir: dir, retry: noSleep }).getListing("B0TEST");
    const url = new URL(requested);
    expect(url.searchParams.get("engine")).toBe("amazon_product");
    expect(url.searchParams.get("asin")).toBe("B0TEST");

    const data = listing?.data as Record<string, unknown>;
    expect(data.related_products).toBeUndefined();
    expect(data.search_metadata).toBeUndefined();
    expect(data.about_item).toEqual(["bullet"]);
    expect(data.related_asins).toEqual(["OTHER"]);

    const saved = await readFile(join(dir, "B0TEST.json"), "utf8");
    expect(saved).not.toContain("secret");
    expect(JSON.parse(saved).product_results.asin).toBe("B0TEST");
    await rm(dir, { recursive: true, force: true });
  });

  test("returns null when Amazon has no such product", async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: "Amazon hasn't returned any results for this query." }))) as unknown as typeof globalThis.fetch;
    expect(await new SerpApiProductData({ apiKey: "k", fetch, retry: noSleep }).getListing("B0NONE")).toBeNull();
  });

  test("throws on other SerpApi errors", async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: "Invalid API key." }))) as unknown as typeof globalThis.fetch;
    await expect(new SerpApiProductData({ apiKey: "k", fetch, retry: noSleep }).getListing("B0X")).rejects.toThrow("Invalid API key");
  });

  test("retries a 503", async () => {
    let n = 0;
    const fetch = (async () => (++n === 1 ? new Response("", { status: 503 }) : new Response(JSON.stringify(body)))) as unknown as typeof globalThis.fetch;
    await new SerpApiProductData({ apiKey: "k", fetch, retry: noSleep }).getListing("B0TEST");
    expect(n).toBe(2);
  });
});

describe("SerpApiSearch and pickCompetitors", () => {
  const { SerpApiSearch, pickCompetitors } = require("./search") as typeof import("./search");
  const body = {
    organic_results: [
      { asin: "B0AD000001", title: "Ad", sponsored: true, reviews: 900 },
      { asin: "B0TARGET01", title: "Me", reviews: 50 },
      { asin: "B0RIVAL001", title: "One", reviews: 80 },
      { asin: "B0RIVAL001", title: "One again", reviews: 80 },
      { asin: "B0RIVAL002", title: "Two" },
    ],
  };

  test("dedupes results and picks organic competitors, excluding the target", async () => {
    const fetch = (async () => new Response(JSON.stringify(body))) as unknown as typeof globalThis.fetch;
    const results = await new SerpApiSearch({ apiKey: "k", fetch, retry: noSleep }).search("gel pens");
    expect(results.map((r) => r.asin)).toEqual(["B0AD000001", "B0TARGET01", "B0RIVAL001", "B0RIVAL002"]);
    expect(pickCompetitors(results, ["B0TARGET01"], 4)).toEqual(["B0RIVAL001", "B0RIVAL002"]);
  });

  test("reuses a saved search instead of calling again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "search-"));
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(body));
    }) as unknown as typeof globalThis.fetch;
    const s = new SerpApiSearch({ apiKey: "k", fetch, snapshotDir: dir, retry: noSleep });
    await s.search("Gel Pens");
    await s.search("Gel Pens");
    expect(calls).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});
