import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gradeListing } from "../grade";
import type { JsonModel, JsonRequest } from "../llm";
import { normalize } from "../normalize";
import type { Grade, ImageClaim, Intent, IntentSet, Listing } from "../types";
import { verifyCoverage } from "./coverage";
import { findHiddenAnswers } from "./hidden";
import { checkCoverage, collectClaims, transcribeImages, type ImageBytes } from "./index";

const ROOT = join(import.meta.dir, "../../../..");
const intentSet = JSON.parse(readFileSync(join(ROOT, "fixtures/intents/gel-ink-pens.json"), "utf8")) as IntentSet;

const listing = normalize({
  source: "paste",
  requestedAsin: "B0TEST0001",
  fetchedAt: "t",
  data: {
    title: "Acme Gel Pens 0.5mm, 6 Pack",
    bullets: ["Quick-drying ink for everyday notes"],
    attributes: { Brand: "Acme", "Hand Orientation": "Ambidextrous" },
    imageUrls: ["https://x/0.jpg", "https://x/1.jpg", "https://x/2.jpg"],
  },
});
listing.meta.brand = "Acme";

const intents: Intent[] = [
  { id: "ink_flow", kind: "claim", question: "Skips?", rubric: "", frequency: 171 },
  { id: "smudge_left_handed", kind: "claim", question: "Lefties?", rubric: "", frequency: 11 },
  { id: "dry_time", kind: "claim", question: "Dry time?", rubric: "", frequency: 87 },
  { id: "smoothness", kind: "experience", question: "Smooth?", rubric: "", frequency: 234 },
];

const claim = (id: string, text: string, imageIds = ["img.0"]): ImageClaim => ({ id, text, imageIds });
const grade = (intentId: string, status: Grade["status"]): Grade => ({ intentId, status, quotes: [], modelStatus: status, flags: [] });

describe("collectClaims", () => {
  test("merges the same claim across images, ignoring case and spacing", () => {
    const claims = collectClaims(listing, [
      { imageId: "img.0", claims: ["Sealed with Wax to Prevent Drying"] },
      { imageId: "img.2", claims: ["sealed withWax to prevent drying"] },
    ]);
    expect(claims).toEqual([{ id: "ic.0", text: "Sealed with Wax to Prevent Drying", imageIds: ["img.0", "img.2"] }]);
  });

  test("drops the brand name, fragments and image ids the model made up", () => {
    const claims = collectClaims(listing, [
      { imageId: "img.0", claims: ["ACME", "ok", "No Smear: Perfect for Left-Handed"] },
      { imageId: "img.9", claims: ["Invented image"] },
    ]);
    expect(claims.map((c) => c.text)).toEqual(["No Smear: Perfect for Left-Handed"]);
  });
});

describe("verifyCoverage", () => {
  test("marks a claim in_text in code when its words are already in a field", () => {
    const [m] = verifyCoverage(listing, [claim("ic.0", "Quick-drying ink")], intents, []);
    expect(m).toMatchObject({ coverage: "in_text", quotes: [{ fieldId: "bullet.1", text: "Quick-drying ink" }] });
  });

  test("keeps a model's partial match only when its quote is real", () => {
    const claims = [claim("ic.0", "No Smear: Perfect for Left-Handed"), claim("ic.1", "Leakproof design")];
    const out = verifyCoverage(listing, claims, intents, [
      { claimId: "ic.0", coverage: "partial", quotes: [{ fieldId: "attr.hand_orientation", text: "Ambidextrous" }], intentId: "smudge_left_handed" },
      { claimId: "ic.1", coverage: "in_text", quotes: [{ fieldId: "bullet.1", text: "leak-proof" }] },
    ]);
    expect(out[0]).toMatchObject({ coverage: "partial", intentId: "smudge_left_handed", flags: [] });
    expect(out[1]).toMatchObject({ coverage: "image_only", flags: ["quote_not_found", "unverified_coverage"] });
  });

  test("drops intent ids that aren't gradable questions", () => {
    const [m] = verifyCoverage(listing, [claim("ic.0", "Silky feel")], intents, [{ claimId: "ic.0", coverage: "image_only", quotes: [], intentId: "smoothness" }]);
    expect(m!.intentId).toBeUndefined();
    expect(m!.flags).toEqual(["unknown_intent"]);
  });

  test("treats claims the model skipped as image_only", () => {
    expect(verifyCoverage(listing, [claim("ic.0", "Writes on glossy photos")], intents, [])[0]!.coverage).toBe("image_only");
  });
});

describe("findHiddenAnswers", () => {
  const claims = [claim("ic.0", "Smooth Writing without Skipping", ["img.2", "img.11"]), claim("ic.1", "No Smear: Perfect for Left-Handed", ["img.8"]), claim("ic.2", "Dries in 1 second")];
  const matches = [
    { claimId: "ic.0", coverage: "image_only" as const, quotes: [], intentId: "ink_flow", flags: [] },
    { claimId: "ic.1", coverage: "partial" as const, quotes: [], intentId: "smudge_left_handed", flags: [] },
    { claimId: "ic.2", coverage: "image_only" as const, quotes: [], intentId: "dry_time", flags: [] },
  ];

  test("needs both: the text grade is missing or partial, and an image answers it", () => {
    const hidden = findHiddenAnswers([grade("ink_flow", "missing"), grade("smudge_left_handed", "partial"), grade("dry_time", "answered")], claims, matches, intents);
    expect(hidden.map((h) => h.intentId)).toEqual(["ink_flow", "smudge_left_handed"]);
    expect(hidden[0]).toMatchObject({ textStatus: "missing", claims: [claims[0]] });
  });

  test("ignores claims the text already covers", () => {
    const covered = [{ ...matches[0]!, coverage: "in_text" as const }];
    expect(findHiddenAnswers([grade("ink_flow", "missing")], claims, covered, intents)).toEqual([]);
  });

  test("orders by how many shoppers ask", () => {
    const hidden = findHiddenAnswers([grade("smudge_left_handed", "missing"), grade("dry_time", "missing"), grade("ink_flow", "missing")], claims, matches, intents);
    expect(hidden.map((h) => h.intentId)).toEqual(["ink_flow", "dry_time", "smudge_left_handed"]);
  });
});

describe("transcribeImages", () => {
  const images: ImageBytes[] = [0, 1, 2].map((n) => ({ id: `img.${n}`, mimeType: "image/jpeg", base64: `AAA${n}` }));
  const imageIdsIn = (req: JsonRequest) => req.parts.flatMap((p) => ("text" in p && /^\[img\.\d+\]$/.test(p.text) ? [p.text.slice(1, -1)] : []));

  test("splits a batch the model refuses for recitation, and reports the one image it still refuses", async () => {
    const batches: string[][] = [];
    const fake: JsonModel = {
      async generateJson<T>(req: JsonRequest) {
        const ids = imageIdsIn(req);
        batches.push(ids);
        if (ids.includes("img.1")) throw Object.assign(new Error("blocked"), { finishReason: "RECITATION" });
        return { data: ids.map((imageId) => ({ imageId, claims: [`claim on ${imageId}`] })) as T, model: "m", usage: { inputTokens: 10, outputTokens: 1 }, latencyMs: 1, cached: false };
      },
    };
    const run = await transcribeImages(listing, images, fake, "m");
    expect(batches).toEqual([["img.0", "img.1", "img.2"], ["img.0", "img.1"], ["img.0"], ["img.1"], ["img.2"]]);
    expect(run.skippedImageIds).toEqual(["img.1"]);
    expect(run.claims.map((c) => c.text)).toEqual(["claim on img.0", "claim on img.2"]);
    expect(run.usage.inputTokens).toBe(20);
  });

  test("passes other errors through", async () => {
    const fake: JsonModel = {
      async generateJson() {
        throw new Error("quota");
      },
    };
    await expect(transcribeImages(listing, images, fake, "m")).rejects.toThrow("quota");
  });
});

/** Replays the hero's recorded transcription and coverage answers. */
describe("recorded hero listing", () => {
  test("finds the two hidden answers: no skipping (171 asking) and left-handed no-smear (11)", async () => {
    const hero = loadListing("B0C9W8DD9S");
    const llm = recordedLlm();
    const grades = (await gradeListing(hero, intentSet, llm, "gemini-3.5-flash-lite")).grades;
    const saved = JSON.parse(readFileSync(join(ROOT, "fixtures/image-claims/serpapi/B0C9W8DD9S.json"), "utf8"));
    const claims = collectClaims(hero, saved.modelOutput);
    const coverage = await checkCoverage(hero, claims, intentSet.intents, llm, "gemini-3.5-flash-lite");
    const hidden = findHiddenAnswers(grades, claims, coverage.matches, intentSet.intents);

    expect(hidden.map((h) => h.intentId)).toEqual(["ink_flow", "smudge_left_handed"]);
    expect(hidden[0]!.claims.map((c) => c.text)).toContain("Smooth Writing without Skipping");
    expect(hidden[1]!.claims[0]).toMatchObject({ text: "No Smear: Perfect for Left-Handed", imageIds: ["img.8"] });
  });
});

function loadListing(asin: string): Listing {
  const data = JSON.parse(readFileSync(join(ROOT, "fixtures/serpapi", `${asin}.json`), "utf8"));
  return normalize({ source: "serpapi", requestedAsin: asin, fetchedAt: "t", data });
}

/** Text-only replay from fixtures/llm, keyed like providers' requestKey. */
function recordedLlm(): JsonModel {
  return {
    async generateJson<T>(req: JsonRequest) {
      const key = createHash("sha256")
        .update(JSON.stringify({ model: req.model, promptVersion: req.promptVersion, temperature: req.temperature ?? 0, schema: req.schema, parts: req.parts }))
        .digest("hex");
      const hit = JSON.parse(readFileSync(join(ROOT, "fixtures/llm", `${key}.json`), "utf8"));
      return { ...hit, data: hit.data as T, cached: true };
    },
  };
}
