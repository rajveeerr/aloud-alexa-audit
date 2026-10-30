import type { SavedListing } from "@aloud/contracts";
import { leafCategory, normalize } from "@aloud/core";
import type { ListingStore } from "@aloud/pipeline";

type Source = SavedListing["source"];

/** Saved listings, so the UI can offer products that audit for free (no live fetch, replayed model calls). */
export async function savedListings(store: ListingStore, sources: Source[]): Promise<SavedListing[]> {
  const out: SavedListing[] = [];
  for (const source of sources) {
    for (const asin of (await store.saved(source)).sort()) {
      const raw = await store.get(source, asin);
      if (!raw) continue;
      const l = normalize(raw);
      const category = leafCategory(l);
      out.push({
        asin,
        source,
        ...(l.meta.brand && { brand: l.meta.brand }),
        title: l.fields.find((f) => f.id === "title")?.text ?? "",
        ...(category && { category }),
      });
    }
  }
  return out;
}

/**
 * The widget only takes an ASIN, so pick a source for it: a saved SerpApi page first (newest data),
 * then a saved dataset record, then SerpApi (which only works with live fetches on).
 */
export async function publicSource(store: ListingStore, asin: string): Promise<Source> {
  if ((await store.saved("serpapi")).includes(asin)) return "serpapi";
  if ((await store.saved("dataset")).includes(asin)) return "dataset";
  return "serpapi";
}
