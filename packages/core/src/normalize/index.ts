import type { Listing, RawListing } from "../types";
import { draftFromDataset } from "./dataset";
import { finalize } from "./draft";
import { draftFromPaste } from "./paste";
import { draftFromSerpApi } from "./serpapi";

export { contentHash } from "./draft";
export type { PastedListing } from "./paste";

/** Turns a listing from any source into the same shape: readable fields, images and meta. */
export function normalize(raw: RawListing): Listing {
  switch (raw.source) {
    case "dataset":
      return finalize(raw, draftFromDataset(raw.data));
    case "serpapi":
      return finalize(raw, draftFromSerpApi(raw.data));
    case "paste":
      return finalize(raw, draftFromPaste(raw.data));
  }
}
