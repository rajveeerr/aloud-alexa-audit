import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { ProductDataProvider, RawListing } from "../types";

/**
 * Amazon Reviews 2023 metadata (McAuley Lab, UCSD) from a JSONL file, keyed by parent_asin.
 * The file is indexed on first use and kept in memory.
 */
export class DatasetProductData implements ProductDataProvider {
  readonly name = "dataset";
  private index: Promise<Map<string, unknown>> | null = null;

  constructor(private readonly metaPath: string) {}

  async getListing(asin: string): Promise<RawListing | null> {
    const index = await this.load();
    const data = index.get(asin);
    if (data === undefined) return null;
    return { source: "dataset", requestedAsin: asin, fetchedAt: "2023-09-01T00:00:00.000Z", data };
  }

  async asins(): Promise<string[]> {
    return [...(await this.load()).keys()];
  }

  private load(): Promise<Map<string, unknown>> {
    this.index ??= (async () => {
      const map = new Map<string, unknown>();
      const lines = createInterface({ input: createReadStream(this.metaPath), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        const record = JSON.parse(line) as { parent_asin?: string };
        if (record.parent_asin) map.set(record.parent_asin, record);
      }
      return map;
    })();
    return this.index;
  }
}
