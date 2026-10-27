import { createHash } from "node:crypto";
import type { Field, FieldKind, Listing, ListingImage, ListingMeta, RawListing } from "../types";
import { cleanText, comparable, isFiller, isPlaceholder, keyLabel, toKey } from "./text";

/**
 * Each source turns its raw shape into a draft. `finalize` then applies the same cleanup to
 * every source, so the rules live in one place.
 */
export type Draft = {
  asin: string;
  marketplace: string;
  title: string;
  /** Bullets, descriptions and A+ text in page order. Position is 1-based, as a seller sees it. */
  texts: { kind: Exclude<FieldKind, "title" | "attribute">; position: number; text: string }[];
  /** Attribute pairs in source order. Later duplicates of the same key and value are dropped. */
  attributes: { label: string; value: string }[];
  images: { kind: ListingImage["kind"]; url: string }[];
  meta: ListingMeta;
};

/**
 * Keys that identify or rate the product rather than describe it. They aren't answers to
 * shopper questions, so they don't become fields. Ratings and rank live in `meta` instead.
 */
const SKIP_ATTRIBUTES = new Set([
  "asin",
  "upc",
  "ean",
  "isbn",
  "gtin",
  "global_trade_identification_number",
  "item_model_number",
  "model_number",
  "manufacturer_part_number",
  "part_number",
  "best_sellers_rank",
  "customer_reviews",
  "rating",
  "reviews",
  "date_first_available",
  "is_discontinued_by_manufacturer",
]);

/** Shorter texts ("Retractable") can legitimately repeat inside a title and still be kept. */
const MIN_CONTAINED = 40;

export function finalize(raw: RawListing, draft: Draft): Listing {
  const fields: Field[] = [];
  const earlier: string[] = [];

  // Returns false when the text adds nothing: empty, a filler heading, or text already said in
  // the title or an earlier field. "Already said" includes being contained in it, which catches
  // a bullet that is just the title minus a few words.
  const keep = (text: string): boolean => {
    const c = comparable(text);
    if (!c || isFiller(text)) return false;
    if (earlier.some((e) => e === c || (c.length >= MIN_CONTAINED && e.includes(c)))) return false;
    earlier.push(c);
    return true;
  };

  const title = cleanText(draft.title);
  if (title) {
    earlier.push(comparable(title));
    fields.push({ id: "title", kind: "title", text: title });
  }

  for (const t of draft.texts) {
    const text = cleanText(t.text);
    if (keep(text)) fields.push({ id: `${t.kind}.${t.position}`, kind: t.kind, text });
  }

  // Attributes: one field per key. If two sources give different values for the same key
  // (title says 6 pens, a spec says 3), both are kept with a suffix. Spotting the conflict is
  // the grader's job, so normalize must not pick a winner.
  const valuesByKey = new Map<string, string[]>();
  for (const { label, value } of draft.attributes) {
    const key = toKey(label);
    const text = cleanText(value);
    if (!key || SKIP_ATTRIBUTES.has(key) || isPlaceholder(text)) continue;
    const values = valuesByKey.get(key) ?? [];
    if (values.some((v) => comparable(v) === comparable(text))) continue;
    values.push(text);
    valuesByKey.set(key, values);
  }
  for (const [key, values] of valuesByKey) {
    values.forEach((value, i) => {
      fields.push({
        id: i === 0 ? `attr.${key}` : `attr.${key}#${i + 1}`,
        kind: "attribute",
        key,
        text: `${keyLabel(key)}: ${value}`,
      });
    });
  }

  const images: ListingImage[] = [];
  const seenUrls = new Set<string>();
  for (const img of draft.images) {
    if (!img.url || seenUrls.has(img.url)) continue;
    seenUrls.add(img.url);
    images.push({ id: `img.${images.length}`, kind: img.kind, url: img.url });
  }

  return {
    asin: draft.asin || raw.requestedAsin,
    requestedAsin: raw.requestedAsin,
    marketplace: draft.marketplace,
    source: raw.source,
    fetchedAt: raw.fetchedAt,
    fields,
    images,
    meta: draft.meta,
    contentHash: contentHash(fields, images),
  };
}

/** Sorted before hashing so the same content always hashes the same. */
export function contentHash(fields: Field[], images: ListingImage[]): string {
  const canonical = JSON.stringify({
    fields: fields.map((f) => [f.id, f.text]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0)),
    images: images.map((i) => `${i.kind}:${i.url}`).sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Narrowing helpers for untyped JSON. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    return value.trim() && Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
