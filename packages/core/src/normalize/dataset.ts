import type { SalesRank } from "../types";
import { asArray, asNumber, asRecord, asString, type Draft } from "./draft";

/** Amazon Reviews 2023 metadata record (McAuley Lab). Data runs to Sep 2023. */
export function draftFromDataset(data: unknown): Draft {
  const d = asRecord(data);
  const details = asRecord(d.details);

  const attributes: Draft["attributes"] = [];
  const salesRanks: SalesRank[] = [];
  for (const [label, value] of Object.entries(details)) {
    // The dataset stores sales rank as { "Office Products": 42, "Gel Ink Pens": 3 }.
    if (label === "Best Sellers Rank") {
      for (const [category, rank] of Object.entries(asRecord(value))) {
        const n = asNumber(rank);
        if (n !== undefined) salesRanks.push({ category, rank: n });
      }
      continue;
    }
    const text = asString(value);
    if (text !== undefined) attributes.push({ label, value: text });
  }

  const texts: Draft["texts"] = [];
  asArray(d.features).forEach((f, i) => {
    const text = asString(f);
    if (text) texts.push({ kind: "bullet", position: i + 1, text });
  });
  asArray(d.description).forEach((f, i) => {
    const text = asString(f);
    if (text) texts.push({ kind: "description", position: i + 1, text });
  });

  const images: Draft["images"] = [];
  for (const img of asArray(d.images)) {
    const r = asRecord(img);
    const url = asString(r.hi_res) ?? asString(r.large);
    if (url) images.push({ kind: "gallery", url });
  }

  const brand = asString(details.Brand) ?? asString(d.store);
  const rating = asNumber(d.average_rating);
  const reviewCount = asNumber(d.rating_number);
  const price = asNumber(d.price);

  return {
    asin: asString(d.parent_asin) ?? "",
    marketplace: "amazon.com",
    title: asString(d.title) ?? "",
    texts,
    attributes,
    images,
    meta: {
      ...(brand && { brand }),
      ...(rating !== undefined && { rating }),
      ...(reviewCount !== undefined && { reviewCount }),
      ...(price !== undefined && { price }),
      categories: asArray(d.categories).flatMap((c) => asString(c) ?? []),
      salesRanks,
    },
  };
}
