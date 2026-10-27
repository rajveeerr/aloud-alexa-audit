import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageStore, sniffMimeType } from "./images";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const noSleep = { sleep: async () => {} };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "images-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sniffMimeType", () => {
  test("recognises jpeg and png and rejects other bytes", () => {
    expect(sniffMimeType(JPEG)).toBe("image/jpeg");
    expect(sniffMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("image/png");
    expect(sniffMimeType(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("ImageStore", () => {
  test("downloads once, then serves from disk", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(JPEG);
    }) as unknown as typeof globalThis.fetch;
    const store = new ImageStore({ cacheDir: dir, fetch, retry: noSleep });
    const a = await store.get("https://example.com/a.jpg");
    const b = await store.get("https://example.com/a.jpg");
    expect(calls).toBe(1);
    expect(a?.mimeType).toBe("image/jpeg");
    expect(b?.base64).toBe(a!.base64);
  });

  test("returns null for a missing image or something that isn't an image", async () => {
    const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch;
    expect(await new ImageStore({ cacheDir: dir, fetch: notFound, retry: noSleep }).get("https://x/1")).toBeNull();
    const html = (async () => new Response("<html>")) as unknown as typeof globalThis.fetch;
    expect(await new ImageStore({ cacheDir: dir, fetch: html, retry: noSleep }).get("https://x/2")).toBeNull();
  });
});
