export type ListingSource = "dataset" | "serpapi" | "paste";

/** What a provider hands to normalize. Core defines its own copy so it never imports I/O code. */
export type RawListing = {
  source: ListingSource;
  requestedAsin: string;
  fetchedAt: string;
  data: unknown;
};

export type FieldKind = "title" | "bullet" | "description" | "attribute" | "aplus";

/**
 * One piece of readable text on the listing. Ids are stable and human-readable
 * ("bullet.2", "attr.paper_weight") so a grade can cite exactly where an answer lives.
 */
export type Field = {
  id: string;
  kind: FieldKind;
  text: string;
  /** Attribute key in snake_case, only for attributes. */
  key?: string;
};

export type ListingImage = {
  id: string;
  kind: "gallery" | "aplus";
  url: string;
};

export type SalesRank = { category: string; rank: number };

/** Facts about the listing that aren't content Alexa reads, kept for the study and the UI. */
export type ListingMeta = {
  brand?: string;
  rating?: number;
  reviewCount?: number;
  price?: number;
  categories: string[];
  salesRanks: SalesRank[];
  /** False when the page says the product is currently unavailable. */
  available?: boolean;
};

export type Listing = {
  /** The ASIN the page actually shows. Can differ from the one requested (variants). */
  asin: string;
  requestedAsin: string;
  marketplace: string;
  source: ListingSource;
  fetchedAt: string;
  fields: Field[];
  images: ListingImage[];
  meta: ListingMeta;
  /** Hash of fields and images. Same content gives the same hash, whatever order it came in. */
  contentHash: string;
};
