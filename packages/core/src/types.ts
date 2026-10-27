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

/** Three kinds of shopper question. Only spec and claim count toward the score. */
export type IntentKind = "spec" | "claim" | "experience";

/** A question shoppers in a category ask, mined from reviews and reviewed by hand. */
export type Intent = {
  id: string;
  kind: IntentKind;
  question: string;
  /** One line saying what counts as answered and partial. The grader sees it. */
  rubric: string;
  /** How many sampled reviews raised it. Weights the score. */
  frequency: number;
  /** True when the question only applies to some products (scent, glitter). */
  conditional?: boolean;
};

export type IntentSet = {
  categoryId: string;
  version: string;
  sampleSize: number;
  intents: Intent[];
};

export type GradeStatus = "answered" | "partial" | "missing" | "contradicted" | "not_applicable";

export type Quote = { fieldId: string; text: string };

/** Why the verifier changed or doubted what the model said. Shown in the UI. */
export type GradeFlag =
  | "quote_not_found"
  | "quote_field_corrected"
  | "unverified_answer"
  | "unverified_contradiction"
  | "not_applicable_rejected"
  | "not_graded";

export type Grade = {
  intentId: string;
  status: GradeStatus;
  /** Only quotes that passed the verifier. */
  quotes: Quote[];
  /** The answer in the listing's words, e.g. "0.5 mm". */
  value?: string;
  /** What the model said before verification, kept for evals and the UI. */
  modelStatus: GradeStatus;
  flags: GradeFlag[];
};
