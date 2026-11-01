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
/**
 * One topic from Amazon's "Customers say" summary: what a product's reviews talk about, with how
 * many reviews mention it. Amazon computes these over all of the product's reviews.
 */
export type ReviewInsight = { topic: string; mentions: number; positive: number; negative: number; summary: string; snippets: string[] };

export type ListingMeta = {
  brand?: string;
  rating?: number;
  reviewCount?: number;
  price?: number;
  categories: string[];
  salesRanks: SalesRank[];
  /** False when the page says the product is currently unavailable. */
  available?: boolean;
  /** Amazon's review topics for this product (live pages only). */
  insights?: ReviewInsight[];
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
  /** For questions built from Amazon review insights: the review topics behind it. */
  insightTopics?: string[];
};

export type IntentSet = {
  categoryId: string;
  /** Human name, e.g. "Gel Ink Rollerball Pens". */
  categoryName: string;
  /** Amazon category names this set applies to, matched against a listing's category path. */
  match: string[];
  version: string;
  /**
   * mined: questions and frequencies come from real reviews.
   * insights: built from Amazon's review topics for the listing and its competitors; each
   * frequency is the number of reviews mentioning that topic, as Amazon counts them.
   * estimated: no reviews were available, so questions were proposed from listings; every
   * frequency is 1 and reports must say the score is estimated.
   */
  basis: "mined" | "insights" | "estimated";
  /** Where mined reviews came from, when it isn't Amazon's 2023 review dataset. */
  reviewSource?: "walmart";
  /** True once a person has checked the questions, kinds and rubrics. */
  reviewed: boolean;
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
  | "conditional_unaddressed"
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

/** A claim printed inside one or more of the listing's images, transcribed word for word. */
export type ImageClaim = {
  id: string;
  text: string;
  /** Every image it appears in, e.g. the same callout on a gallery and an A+ image. */
  imageIds: string[];
};

/**
 * in_text: the readable text already says it. partial: the text says part of it.
 * image_only: only an image says it, so Alexa may not read it.
 */
export type ClaimCoverage = "in_text" | "partial" | "image_only";

export type ClaimMatch = {
  claimId: string;
  coverage: ClaimCoverage;
  /** Verified quotes from text fields that cover the claim. Empty for image_only. */
  quotes: Quote[];
  /** The shopper question the claim answers, if any. */
  intentId?: string;
  flags: ("quote_not_found" | "unverified_coverage" | "unknown_intent")[];
};

/** The lead finding: the brand already answers a question, but only inside an image. */
export type HiddenAnswer = {
  intentId: string;
  /** How the readable text does on that question: missing or partial. */
  textStatus: "missing" | "partial";
  claims: ImageClaim[];
};

/** One question the listing doesn't fully answer, ranked against its competitors. */
export type Gap = {
  intentId: string;
  /** The listing's own verified status on this question. */
  status: "missing" | "partial" | "contradicted";
  frequency: number;
  /** Share of competitors that answer it: answered counts 1, partial 0.5. Null with no competitors. */
  competitorShare: number | null;
  competitorsAnswering: { asin: string; brand?: string; quote: Quote }[];
  /** Answers the brand already gives, but only in images. */
  hiddenClaims: ImageClaim[];
  priority: number;
};

export type BriefAction = "fix_contradiction" | "move_from_image" | "edit_field" | "add_bullet" | "request_fact";

export type BriefSource = { kind: "field" | "image"; id: string; text: string };

/** A fix ready for a copy tool like Creative Studio. Facts only ever come from the brand's own data. */
export type Brief = {
  intentId: string;
  question: string;
  action: BriefAction;
  /** Existing field id to edit, "new_bullet", or "attr.<key>". */
  target: string;
  /** Suggested copy. Absent for request_fact. */
  draft?: string;
  /** Brand data the draft is built from, verified to exist. */
  sources: BriefSource[];
  /** For request_fact: what the brand needs to supply. */
  needsFromBrand?: string;
  priority: number;
  flags: (
    | "source_not_found"
    | "unsourced_number"
    | "invalid_target"
    | "no_brand_source"
    | "not_drafted"
    | "unsupported_claim"
    | "off_question"
    | "repeats_field"
  )[];
  /** Statements the faithfulness check found in the model's draft that the sources don't support. */
  rejectedStatements?: string[];
};
