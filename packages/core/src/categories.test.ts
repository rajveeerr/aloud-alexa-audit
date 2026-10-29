import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { leafCategory, resolveIntentSet } from "./categories";
import { gradeListing } from "./grade";
import type { JsonModel, JsonRequest } from "./llm";
import { normalize } from "./normalize";
import { scoreGrades } from "./score";
import type { IntentSet, Listing } from "./types";

const ROOT = join(import.meta.dir, "../../..");
const sets: IntentSet[] = readdirSync(join(ROOT, "fixtures/intents")).sort().map((f) => JSON.parse(readFileSync(join(ROOT, "fixtures/intents", f), "utf8")));

function load(asin: string): Listing {
  const data = JSON.parse(readFileSync(join(ROOT, "fixtures/dataset", `${asin}.json`), "utf8"));
  return normalize({ source: "dataset", requestedAsin: asin, fetchedAt: "t", data });
}

/**
 * The same pipeline on categories it wasn't built for: two mined from reviews, one estimated
 * because no reviews were mined. Replays recorded answers from fixtures/llm.
 */
describe("other categories", () => {
  const cases: [string, string, number][] = [
    ["B08PD98HYG", "mechanical-pencils", 59],
    ["B0BM4LCNPL", "mechanical-pencils", 24],
    ["B09VD1Z3TK", "dry-erase-boards", 84],
    ["B0B42X682C", "dry-erase-boards", 52],
    ["B00P6N6LC2", "water-bottles", 60],
    ["B0832N947Y", "water-bottles", 90],
  ];

  for (const [asin, categoryId, expected] of cases) {
    test(`${asin} picks the ${categoryId} questions and scores ${expected}`, async () => {
      const listing = load(asin);
      const set = resolveIntentSet(listing, sets);
      expect(set?.categoryId).toBe(categoryId);
      const run = await gradeListing(listing, set!, recordedLlm(), "gemini-3.5-flash-lite");
      expect(scoreGrades(run.grades, set!.intents).score).toBe(expected);
    });
  }

  test("each category gets its own questions", () => {
    const ids = (id: string) => sets.find((s) => s.categoryId === id)!.intents.map((i) => i.id);
    expect(ids("dry-erase-boards").some((i) => i.includes("magnetic"))).toBe(true);
    expect(ids("mechanical-pencils").some((i) => i.includes("lead"))).toBe(true);
    expect(ids("gel-ink-pens")).toContain("smudge_left_handed");
  });

  test("an estimated set says so and weights every question the same", () => {
    const bottles = sets.find((s) => s.categoryId === "water-bottles")!;
    expect(bottles.basis).toBe("estimated");
    expect(new Set(bottles.intents.map((i) => i.frequency))).toEqual(new Set([1]));
    expect(leafCategory(load("B00P6N6LC2"))).toBe("Water Bottles");
  });

  test("a mined set that hasn't been checked by a person is marked unreviewed", () => {
    expect(sets.find((s) => s.categoryId === "mechanical-pencils")!.reviewed).toBe(false);
    expect(sets.find((s) => s.categoryId === "gel-ink-pens")!.reviewed).toBe(true);
  });
});

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
