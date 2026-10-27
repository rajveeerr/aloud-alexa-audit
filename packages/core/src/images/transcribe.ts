import type { JsonModel, PromptPart } from "../llm";
import { comparable } from "../normalize/text";
import type { ImageClaim, Listing } from "../types";

export const TRANSCRIBE_PROMPT_VERSION = "transcribe@2026-10-27.1";

const INSTRUCTIONS = `These are the images on an Amazon product listing, each labelled [img.N] just before it.
For each image, copy out every product claim or fact that is written in the image: text overlays, callouts,
badges, chart cells, dimension labels. Copy the words exactly as printed.
Skip: brand names, logos, product line or model names, decorative words, and anything you'd have to guess.
Don't describe the picture. Only transcribe text that is actually printed in it.
Return one entry per image, with an empty list when an image has no such text.`;

export const TRANSCRIBE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      imageId: { type: "STRING" },
      claims: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["imageId", "claims"],
  },
} as const;

export type ImageBytes = { id: string; mimeType: string; base64: string };

export function buildTranscribeParts(images: ImageBytes[]): PromptPart[] {
  const parts: PromptPart[] = [{ text: INSTRUCTIONS }];
  for (const img of images) {
    parts.push({ text: `[${img.id}]` });
    parts.push({ image: { mimeType: img.mimeType, base64: img.base64 } });
  }
  return parts;
}

/**
 * Turns the model's per-image lists into one list of claims:
 * - drops text that's only the brand name, or too short to be a claim;
 * - merges the same claim seen on several images (gallery and A+ often repeat a callout);
 * - ignores image ids the model made up.
 */
export function collectClaims(listing: Listing, modelOutput: unknown): ImageClaim[] {
  const knownImages = new Set(listing.images.map((i) => i.id));
  const brand = comparable(listing.meta.brand ?? "");
  const byText = new Map<string, ImageClaim>();

  for (const entry of Array.isArray(modelOutput) ? modelOutput : []) {
    const imageId = typeof entry?.imageId === "string" ? entry.imageId : "";
    if (!knownImages.has(imageId)) continue;
    for (const raw of Array.isArray(entry.claims) ? entry.claims : []) {
      if (typeof raw !== "string") continue;
      const text = raw.replace(/\s+/g, " ").trim();
      // Spaces are ignored when merging: the model reads the same callout as "with Wax to"
      // on one image and "withWax to" on another.
      const key = comparable(text).replace(/ /g, "");
      if (key.length < 3 || key === brand.replace(/ /g, "")) continue;
      const existing = byText.get(key);
      if (existing) {
        if (!existing.imageIds.includes(imageId)) existing.imageIds.push(imageId);
      } else {
        byText.set(key, { id: `ic.${byText.size}`, text, imageIds: [imageId] });
      }
    }
  }
  return [...byText.values()];
}

export type TranscribeRun = {
  claims: ImageClaim[];
  modelOutput: unknown[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  cached: boolean;
  /** Images the model refused to read even on their own, e.g. its recitation filter. */
  skippedImageIds: string[];
};

/** Gemini blocks some verbatim transcriptions as recitation. That's about the batch, not an error. */
function isRecitationBlock(err: unknown): boolean {
  return (err as { finishReason?: string } | null)?.finishReason === "RECITATION";
}

/**
 * One vision request for all of a listing's images. If the model refuses the batch for
 * recitation, split it in half and try each half, down to single images. An image refused on
 * its own is skipped and reported, never silently dropped.
 */
export async function transcribeImages(
  listing: Listing,
  images: ImageBytes[],
  llm: JsonModel,
  model: string,
): Promise<TranscribeRun> {
  const run: TranscribeRun = { claims: [], modelOutput: [], model, usage: { inputTokens: 0, outputTokens: 0 }, cached: true, skippedImageIds: [] };

  const attempt = async (batch: ImageBytes[]): Promise<void> => {
    if (batch.length === 0) return;
    try {
      const res = await llm.generateJson({
        model,
        promptVersion: TRANSCRIBE_PROMPT_VERSION,
        parts: buildTranscribeParts(batch),
        schema: TRANSCRIBE_SCHEMA,
        temperature: 0,
      });
      if (Array.isArray(res.data)) run.modelOutput.push(...res.data);
      run.model = res.model;
      run.usage.inputTokens += res.usage.inputTokens;
      run.usage.outputTokens += res.usage.outputTokens;
      run.cached &&= res.cached;
    } catch (err) {
      if (!isRecitationBlock(err)) throw err;
      if (batch.length === 1) {
        run.skippedImageIds.push(batch[0]!.id);
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await attempt(batch.slice(0, mid));
      await attempt(batch.slice(mid));
    }
  };

  await attempt(images);
  run.claims = collectClaims(listing, run.modelOutput);
  return run;
}
