import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRetryableStatus, withRetry, type RetryOptions } from "./retry";
import { ProviderError } from "./types";

export type ImageData = { mimeType: string; base64: string };

/** Detects the format from the first bytes, so a wrong or missing Content-Type doesn't matter. */
export function sniffMimeType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}

export type ImageStoreOptions = {
  /** Downloaded images are kept here, named by a hash of the URL. Keep it out of git. */
  cacheDir: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
  /** Images bigger than this are skipped rather than sent to the model. */
  maxBytes?: number;
};

/** Fetches listing images once and serves them from disk afterwards. */
export class ImageStore {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: ImageStoreOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  async get(url: string): Promise<ImageData | null> {
    const path = join(this.opts.cacheDir, createHash("sha256").update(url).digest("hex").slice(0, 32));
    let bytes: Uint8Array | null = await readFile(path).then(
      (b) => new Uint8Array(b),
      () => null,
    );

    if (!bytes) {
      bytes = await withRetry(async () => {
        const res = await this.fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new ProviderError(`Image fetch returned ${res.status}`, "images", res.status, isRetryableStatus(res.status));
        return new Uint8Array(await res.arrayBuffer());
      }, this.opts.retry);
      if (!bytes) return null;
      await mkdir(this.opts.cacheDir, { recursive: true });
      await writeFile(path, bytes);
    }

    if (bytes.byteLength > (this.opts.maxBytes ?? 7_000_000)) return null;
    const mimeType = sniffMimeType(bytes);
    if (!mimeType) return null;
    return { mimeType, base64: Buffer.from(bytes).toString("base64") };
  }
}
