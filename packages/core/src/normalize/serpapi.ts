import type { ReviewInsight, SalesRank } from "../types";
import { asArray, asNumber, asRecord, asString, type Draft } from "./draft";

/** SerpApi `amazon_product` response for a live listing. */
export function draftFromSerpApi(data: unknown): Draft {
  const d = asRecord(data);
  const product = asRecord(d.product_results);
  const specs = asRecord(d.item_specifications);
  const details = asRecord(d.product_details);

  const texts: Draft["texts"] = [];
  asArray(d.about_item).forEach((b, i) => {
    const text = asString(b);
    if (text) texts.push({ kind: "bullet", position: i + 1, text });
  });
  const description = asString(product.description);
  if (description) texts.push({ kind: "description", position: 1, text: description });

  const { aplusTexts, aplusImages } = readAplus(asArray(d.product_description));
  aplusTexts.forEach((text, i) => texts.push({ kind: "aplus", position: i + 1, text }));

  // Specs first: they're the short, structured set Amazon shows near the top of the page.
  const attributes: Draft["attributes"] = [];
  for (const source of [specs, details]) {
    for (const [label, value] of Object.entries(source)) {
      const text = asString(value);
      if (text !== undefined) attributes.push({ label, value: text });
    }
  }

  const images: Draft["images"] = [
    ...asArray(product.thumbnails).flatMap((u) => {
      const url = asString(u);
      return url ? [{ kind: "gallery" as const, url }] : [];
    }),
    ...aplusImages.map((url) => ({ kind: "aplus" as const, url })),
  ];

  const brand = asString(specs.brand) ?? asString(details.brand_name) ?? storeBrand(asString(product.brand));
  const rating = asNumber(product.rating);
  const reviewCount = asNumber(product.reviews);
  const price = asNumber(product.extracted_price);
  const stock = asString(product.stock);
  const insights = readInsights(asArray(asRecord(asRecord(d.reviews_information).summary).insights));

  return {
    asin: asString(product.asin) ?? "",
    marketplace: "amazon.com",
    title: asString(product.title) ?? "",
    texts,
    attributes,
    images,
    meta: {
      ...(brand && { brand }),
      ...(rating !== undefined && { rating }),
      ...(reviewCount !== undefined && { reviewCount }),
      ...(price !== undefined && { price }),
      categories: asArray(product.categories).flatMap((c) => asString(asRecord(c).name) ?? []),
      salesRanks: readSalesRanks(asArray(details.best_sellers_rank)),
      ...(stock && { available: !/unavailable/i.test(stock) }),
      ...(insights.length > 0 && { insights }),
    },
  };
}

/**
 * Amazon's "Customers say" topics: a name, how many reviews mention it (split by sentiment), a
 * one-line summary and a few real review snippets. Topics without a mention count are dropped,
 * since the count is what makes them useful as demand.
 */
function readInsights(items: unknown[]): ReviewInsight[] {
  const out: ReviewInsight[] = [];
  for (const item of items) {
    const r = asRecord(item);
    const m = asRecord(r.mentions);
    const topic = asString(r.title)?.trim();
    const mentions = asNumber(m.total);
    if (!topic || mentions === undefined || mentions <= 0) continue;
    out.push({
      topic,
      mentions,
      positive: asNumber(m.positive) ?? 0,
      negative: asNumber(m.negative) ?? 0,
      ...(/^(positive|negative|mixed)$/.test(asString(r.sentiment) ?? "") && { sentiment: asString(r.sentiment) as "positive" | "negative" | "mixed" }),
      summary: asString(r.summary)?.trim() ?? "",
      snippets: asArray(r.examples).flatMap((e) => asString(asRecord(e).snippet)?.trim() ?? []).slice(0, 3),
    });
  }
  return out;
}

/**
 * A+ modules arrive as blocks with an image, a title, a carousel, or a grid of feature cards.
 * Many titles are just module numbers ("1", "5"), which aren't content.
 */
function readAplus(blocks: unknown[]): { aplusTexts: string[]; aplusImages: string[] } {
  const aplusTexts: string[] = [];
  const aplusImages: string[] = [];

  const visit = (node: unknown) => {
    const r = asRecord(node);
    for (const key of ["title", "description", "text"]) {
      const text = asString(r[key]);
      if (text && isRealText(text)) aplusTexts.push(text);
    }
    const image = asString(r.image);
    if (image) aplusImages.push(image);
    for (const child of [...asArray(r.carousel_images), ...asArray(r.features)]) visit(child);
  };

  blocks.forEach(visit);
  return { aplusTexts, aplusImages };
}

function isRealText(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || /^\d+$/.test(t)) return false;
  // Short labels that name the A+ layout ("White Bag A+ Header", "Benefits Callouts") or repeat a
  // word back to back ("Problem Problem Solution") are the seller's module names, not shopper text.
  if (t.length < 60 && (/\bA\+|\bmodules?\b|\bheaders?\b|\bcallouts?\b/i.test(t) || /\b(\w+) \1\b/i.test(t))) return false;
  return true;
}

/** "Visit the PILOT Store" becomes "PILOT". */
function storeBrand(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const store = /^Visit the (.+) Store$/i.exec(label.trim());
  if (store) return store[1];
  return label.replace(/^Brand:\s*/i, "").trim() || undefined;
}

/** "#1 in Office Products (See Top 100 in Office Products)" with extracted_rank 1. */
function readSalesRanks(entries: unknown[]): SalesRank[] {
  return entries.flatMap((e) => {
    const r = asRecord(e);
    const rank = asNumber(r.extracted_rank);
    const category = /#[\d,]+ in (.+?)(?:\s*\(|$)/.exec(asString(r.text) ?? "")?.[1]?.trim();
    return rank !== undefined && category ? [{ category, rank }] : [];
  });
}
