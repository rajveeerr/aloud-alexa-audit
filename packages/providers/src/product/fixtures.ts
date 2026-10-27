import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ListingSource, ProductDataProvider, RawListing } from "../types";

/** Reads recorded listings from `<root>/<source>/<asin>.json`. Never touches the network. */
export class FixtureProductData implements ProductDataProvider {
  readonly name: string;

  constructor(
    private readonly root: string,
    private readonly source: Exclude<ListingSource, "paste">,
  ) {
    this.name = `fixtures:${source}`;
  }

  async getListing(asin: string): Promise<RawListing | null> {
    const path = join(this.root, this.source, `${asin}.json`);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return {
      source: this.source,
      requestedAsin: asin,
      fetchedAt: this.source === "dataset" ? "2023-09-01T00:00:00.000Z" : "2026-10-27T00:00:00.000Z",
      data: JSON.parse(text),
    };
  }
}
