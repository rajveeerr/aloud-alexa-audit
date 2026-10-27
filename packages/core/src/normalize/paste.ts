import { asArray, asRecord, asString, type Draft } from "./draft";

/** What a person pastes into the app when there's no API: the listing's visible text. */
export type PastedListing = {
  asin?: string;
  title: string;
  bullets?: string[];
  description?: string;
  attributes?: Record<string, string>;
  imageUrls?: string[];
};

export function draftFromPaste(data: unknown): Draft {
  const d = asRecord(data);

  const texts: Draft["texts"] = [];
  asArray(d.bullets).forEach((b, i) => {
    const text = asString(b);
    if (text) texts.push({ kind: "bullet", position: i + 1, text });
  });
  // Pasted descriptions are one block; blank lines separate paragraphs.
  (asString(d.description) ?? "")
    .split(/\n\s*\n/)
    .forEach((p, i) => p.trim() && texts.push({ kind: "description", position: i + 1, text: p }));

  const attributes = Object.entries(asRecord(d.attributes)).flatMap(([label, value]) => {
    const text = asString(value);
    return text !== undefined ? [{ label, value: text }] : [];
  });

  return {
    asin: asString(d.asin) ?? "",
    marketplace: "amazon.com",
    title: asString(d.title) ?? "",
    texts,
    attributes,
    images: asArray(d.imageUrls).flatMap((u) => {
      const url = asString(u);
      return url ? [{ kind: "gallery" as const, url }] : [];
    }),
    meta: { categories: [], salesRanks: [] },
  };
}
