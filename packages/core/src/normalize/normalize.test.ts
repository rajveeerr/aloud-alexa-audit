import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Listing, ListingSource, RawListing } from "../types";
import { normalize } from "./index";
import { cleanText, toKey } from "./text";

const FIXTURES = join(import.meta.dir, "../../../../fixtures");

function load(source: Exclude<ListingSource, "paste">, asin: string): Listing {
  const data = JSON.parse(readFileSync(join(FIXTURES, source, `${asin}.json`), "utf8"));
  return normalize({ source, requestedAsin: asin, fetchedAt: "2026-10-27T00:00:00.000Z", data });
}

const field = (l: Listing, id: string) => l.fields.find((f) => f.id === id);
const ids = (l: Listing) => l.fields.map((f) => f.id);

describe("dataset listings", () => {
  const g2 = load("dataset", "B09YP9YYZG");

  test("maps title, bullets, description and attributes to field ids", () => {
    expect(field(g2, "title")?.text).toStartWith("PILOT G2 Premium");
    expect(ids(g2)).toContain("bullet.1");
    expect(ids(g2)).toContain("description.1");
    expect(field(g2, "attr.line_size")?.text).toBe("Line size: 0.7 Millimeters");
  });

  test("moves sales rank into meta instead of fields", () => {
    expect(g2.meta.salesRanks).toEqual([
      { category: "Office Products", rank: 42 },
      { category: "Gel Ink Pens", rank: 3 },
    ]);
    expect(ids(g2).some((id) => id.includes("best_sellers"))).toBe(false);
  });

  test("keeps gallery images in order with stable ids", () => {
    expect(g2.images[0]).toMatchObject({ id: "img.0", kind: "gallery" });
    expect(g2.images.every((i) => i.url.startsWith("https://"))).toBe(true);
  });

  test("a listing with no bullets or description is still valid", () => {
    const scentco = load("dataset", "B08CMWPFR1");
    expect(scentco.fields.filter((f) => f.kind === "bullet")).toHaveLength(0);
    expect(scentco.fields.filter((f) => f.kind === "description")).toHaveLength(0);
    expect(field(scentco, "title")).toBeDefined();
    expect(scentco.fields.filter((f) => f.kind === "attribute").length).toBeGreaterThan(5);
  });

  test("drops a bullet that only repeats the title", () => {
    const uniball = load("dataset", "B0143LMAEK");
    expect(uniball.fields.filter((f) => f.kind === "bullet")).toHaveLength(0);
  });

  test("keeps conflicting facts for the grader: title says 6 pens, description says 3", () => {
    const uniball = load("dataset", "B0143LMAEK");
    expect(field(uniball, "title")?.text).toContain("6 pens per Pack");
    expect(field(uniball, "description.1")?.text).toContain("3 pens per Pack");
  });
});

describe("live SerpApi listings", () => {
  test("records the ASIN the page resolved to, next to the one requested", () => {
    const sharpie = load("serpapi", "B0BSMKF5BQ");
    expect(sharpie.requestedAsin).toBe("B0BSMKF5BQ");
    expect(sharpie.asin).toBe("B0BYPTVZH6");
  });

  test("keeps both sides of a contradiction across attributes", () => {
    const sharpie = load("serpapi", "B0BSMKF5BQ");
    expect(field(sharpie, "attr.color")?.text).toBe("Color: Green");
    expect(field(sharpie, "attr.ink_color")?.text).toBe("Ink color: Blue,Green");
  });

  test("merges specs and details without repeating a key with the same value", () => {
    const hero = load("serpapi", "B0C9W8DD9S");
    expect(hero.fields.filter((f) => f.key === "brand")).toHaveLength(1);
    expect(ids(hero).some((id) => id.startsWith("attr.brand#"))).toBe(false);
  });

  test("skips identifiers, ratings and rank as fields, and keeps rank in meta", () => {
    const g2 = load("serpapi", "B001GAOTSW");
    for (const key of ["asin", "upc", "global_trade_identification_number", "best_sellers_rank", "rating", "reviews", "customer_reviews"]) {
      expect(field(g2, `attr.${key}`)).toBeUndefined();
    }
    expect(g2.meta.salesRanks[0]).toEqual({ category: "Office Products", rank: 20 });
    expect(g2.meta.reviewCount).toBe(56668);
  });

  test("reads A+ feature-card headings as text and their images as A+ images", () => {
    const g2 = load("serpapi", "B001GAOTSW");
    const aplus = g2.fields.filter((f) => f.kind === "aplus").map((f) => f.text);
    expect(aplus).toContain("Super Smooth Writing");
    expect(g2.images.some((i) => i.kind === "aplus")).toBe(true);
  });

  test("ignores A+ titles that are only module numbers or placeholders", () => {
    for (const asin of ["B0C9W8DD9S", "B0BGPYR8Q3", "B0BSMKF5BQ"]) {
      const l = load("serpapi", asin);
      for (const f of l.fields.filter((x) => x.kind === "aplus")) {
        expect(f.text).not.toMatch(/^\d+$/);
        expect(f.text.toLowerCase()).not.toBe("image");
      }
    }
  });

  test("decodes double-encoded entities", () => {
    const g2 = load("serpapi", "B001GAOTSW");
    expect(g2.fields.some((f) => f.text.includes("America's Go-2"))).toBe(true);
    expect(g2.fields.some((f) => /&#?\w+;/.test(f.text))).toBe(false);
  });

  test("collects carousel images inside A+ blocks", () => {
    const hero = load("serpapi", "B0C9W8DD9S");
    expect(hero.images.filter((i) => i.kind === "gallery")).toHaveLength(9);
    expect(hero.images.filter((i) => i.kind === "aplus").length).toBeGreaterThanOrEqual(4);
  });

  test("reads brand from specs rather than the 'Visit the Store' link text", () => {
    expect(load("serpapi", "B001GAOTSW").meta.brand).toBe("PILOT");
  });
});

describe("paste mode", () => {
  const raw: RawListing = {
    source: "paste",
    requestedAsin: "B0PASTE001",
    fetchedAt: "2026-10-28T00:00:00.000Z",
    data: {
      title: "Gel Pens 0.5mm, 10 Pack",
      bullets: ["Quick-drying ink", "", "Quick-drying ink"],
      description: "Product Description\n\nGreat for journaling.\n\nWon't bleed through.",
      attributes: { "Ink Color": "Black", Manufacturer: "0", UPC: "123" },
    },
  };
  const l = normalize(raw);

  test("drops empty and repeated bullets, filler headings and placeholder values", () => {
    expect(l.fields.filter((f) => f.kind === "bullet").map((f) => f.text)).toEqual(["Quick-drying ink"]);
    expect(l.fields.filter((f) => f.kind === "description").map((f) => f.text)).toEqual([
      "Great for journaling.",
      "Won't bleed through.",
    ]);
    expect(ids(l)).toEqual(["title", "bullet.1", "description.2", "description.3", "attr.ink_color"]);
  });

  test("falls back to the requested ASIN when the paste has none", () => {
    expect(l.asin).toBe("B0PASTE001");
  });
});

describe("contentHash", () => {
  test("is stable for the same content", () => {
    expect(load("serpapi", "B0C9W8DD9S").contentHash).toBe(load("serpapi", "B0C9W8DD9S").contentHash);
  });

  test("doesn't depend on attribute order", () => {
    const base = { source: "paste" as const, requestedAsin: "X", fetchedAt: "t" };
    const a = normalize({ ...base, data: { title: "Pen", attributes: { Color: "Black", Size: "Fine" } } });
    const b = normalize({ ...base, data: { title: "Pen", attributes: { Size: "Fine", Color: "Black" } } });
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("changes when the text changes", () => {
    const base = { source: "paste" as const, requestedAsin: "X", fetchedAt: "t" };
    const a = normalize({ ...base, data: { title: "Pen", bullets: ["Smudge-free"] } });
    const b = normalize({ ...base, data: { title: "Pen", bullets: ["Smudge-free for left-handed writers"] } });
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  test("doesn't depend on fetch time", () => {
    const data = { title: "Pen" };
    const a = normalize({ source: "paste", requestedAsin: "X", fetchedAt: "2026-01-01", data });
    const b = normalize({ source: "paste", requestedAsin: "X", fetchedAt: "2026-06-01", data });
    expect(a.contentHash).toBe(b.contentHash);
  });
});

describe("text helpers", () => {
  test("cleanText strips tags, entities and extra whitespace", () => {
    expect(cleanText("  Lovely&nbsp;ink<br />Writes &amp;#39;well&#39;  ")).toBe("Lovely ink Writes 'well'");
  });

  test("toKey normalises labels from both sources to the same key", () => {
    expect(toKey("Item Weight")).toBe("item_weight");
    expect(toKey("item_weight")).toBe("item_weight");
    expect(toKey("Best Sellers Rank")).toBe("best_sellers_rank");
  });
});
