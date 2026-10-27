import { comparable } from "./normalize/text";
import type { IntentSet, Listing } from "./types";

/**
 * Picks the question set for a listing from its Amazon category path, deepest category first,
 * so "Gel Ink Rollerball Pens" wins over "Office Products". Null means no set exists yet: mine
 * one from reviews, or estimate one.
 */
export function resolveIntentSet(listing: Listing, sets: IntentSet[]): IntentSet | null {
  const path = [...listing.meta.categories].reverse().map(comparable);
  for (const name of path) {
    const hit = sets.find((s) => s.match.some((m) => comparable(m) === name));
    if (hit) return hit;
  }
  return null;
}

/** The most specific category on the listing, used to name a new question set. */
export function leafCategory(listing: Listing): string | null {
  return listing.meta.categories.at(-1) ?? null;
}
