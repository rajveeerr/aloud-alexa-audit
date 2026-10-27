import { describe, expect, test } from "bun:test";
import { resolveIntentSet } from "./categories";
import type { JsonModel, JsonRequest } from "./llm";
import { estimateIntents, mineIntents, sampleReviews, type ReviewText } from "./mine";
import { normalize } from "./normalize";
import type { IntentSet, Listing } from "./types";

const review = (asin: string, text: string, helpfulVotes = 0): ReviewText => ({ asin, title: "t", text: text.padEnd(130, "."), helpfulVotes });

describe("sampleReviews", () => {
  const reviews = [
    review("A", "a1", 1),
    review("A", "a2", 9),
    review("A", "a3", 5),
    review("B", "b1", 0),
    review("C", "c1", 0),
    review("C", "c2", 0),
    { asin: "A", title: "t", text: "too short", helpfulVotes: 99 },
  ];

  test("takes the most-reviewed products first and their most helpful reviews", () => {
    const s = sampleReviews(reviews, { perProduct: 2, maxProducts: 2 });
    // A has 3 usable reviews, C has 2, B has 1: so A and C, and A's two most helpful.
    expect(s.slice(0, 2).map((r) => r.text.slice(0, 2))).toEqual(["a2", "a3"]);
    expect(s.slice(2).map((r) => r.asin)).toEqual(["C", "C"]);
  });

  test("skips reviews that are too short and products that are excluded", () => {
    const s = sampleReviews(reviews, { excludeAsins: ["A"] });
    expect(s.every((r) => r.asin !== "A")).toBe(true);
    expect(sampleReviews(reviews).some((r) => r.text === "too short")).toBe(false);
  });

  test("is deterministic", () => {
    expect(sampleReviews(reviews)).toEqual(sampleReviews([...reviews].reverse()));
  });
});

/** A fake model that answers extraction batches and the clustering call from fixed data. */
function fakeMiner(needsFor: (i: number) => string[], clusters: unknown[]): JsonModel & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async generateJson<T>(req: JsonRequest) {
      calls.push(req.promptVersion.split("@")[0]!);
      const text = "text" in req.parts[0]! ? req.parts[0].text : "";
      const data = req.promptVersion.startsWith("extract")
        ? [...text.matchAll(/^\[(\d+)\]/gm)].map((m) => ({ i: Number(m[1]), needs: needsFor(Number(m[1])) }))
        : clusters;
      return { data: data as T, model: "fake", usage: { inputTokens: 100, outputTokens: 10 }, latencyMs: 1, cached: false };
    },
  };
}

describe("mineIntents", () => {
  const reviews = Array.from({ length: 40 }, (_, k) => review(`P${k % 4}`, `review ${k}`));
  const base = { categoryId: "pencils", categoryName: "Mechanical Pencils", match: ["Mechanical Pencils"], version: "v1", reviews, batchSize: 15 };

  test("counts reviews, not mentions, and only counts needs that really came out of reviews", async () => {
    // Reviews 0-9 ask about lead size (one of them twice, under two names); 10-14 about eraser.
    const needs = (i: number) => (i < 10 ? ["lead_size", ...(i === 0 ? ["Lead Size"] : [])] : i < 15 ? ["eraser"] : []);
    const llm = fakeMiner(needs, [
      { id: "lead_size", question: "What lead size?", kind: "spec", rubric: "answered: mm", members: ["lead_size", "lead_width_invented"] },
      { id: "eraser", question: "Has an eraser?", kind: "spec", rubric: "answered: yes/no", members: ["eraser"] },
    ]);
    const { intentSet, report } = await mineIntents(base, llm, "fake");
    expect(intentSet.intents.map((i) => [i.id, i.frequency])).toEqual([
      ["lead_size", 10],
      ["eraser", 5],
    ]);
    expect(intentSet).toMatchObject({ basis: "mined", reviewed: false, sampleSize: 40, version: "v1" });
    expect(report.coverage).toBe(1);
    expect(llm.calls).toEqual(["extract-needs", "extract-needs", "extract-needs", "cluster-needs"]);
    expect(report.usage.requests).toBe(4);
  });

  test("drops questions too rare to trust and reports needs left out", async () => {
    const needs = (i: number) => (i < 10 ? ["lead_size"] : i < 12 ? ["clip_color"] : i < 15 ? ["grip"] : []);
    const llm = fakeMiner(needs, [
      { id: "lead_size", question: "q", kind: "spec", rubric: "r", members: ["lead_size"] },
      { id: "clip_color", question: "q", kind: "spec", rubric: "r", members: ["clip_color"] },
    ]);
    const { intentSet, report } = await mineIntents(base, llm, "fake");
    expect(intentSet.intents.map((i) => i.id)).toEqual(["lead_size"]);
    expect(report.dropped).toEqual(["clip_color"]);
    expect(report.unassigned).toEqual([
      ["grip", 3],
      ["clip_color", 2],
    ]);
  });

  test("a need claimed by two questions only counts for the first", async () => {
    const llm = fakeMiner((i) => (i < 10 ? ["lead_size"] : []), [
      { id: "lead_size", question: "q", kind: "spec", rubric: "r", members: ["lead_size"] },
      { id: "lead_again", question: "q", kind: "spec", rubric: "r", members: ["lead_size"] },
    ]);
    const { intentSet } = await mineIntents(base, llm, "fake");
    expect(intentSet.intents.map((i) => i.id)).toEqual(["lead_size"]);
  });

  test("ignores review indexes outside the batch and unknown kinds", async () => {
    const llm: JsonModel = {
      async generateJson<T>(req: JsonRequest) {
        const data = req.promptVersion.startsWith("extract")
          ? [{ i: 999, needs: ["ghost"] }, { i: 0, needs: ["lead_size"] }, { i: 1, needs: ["lead_size"] }, { i: 2, needs: ["lead_size"] }]
          : [
              { id: "lead_size", question: "q", kind: "spec", rubric: "r", members: ["lead_size"] },
              { id: "ghost", question: "q", kind: "opinion", rubric: "r", members: ["ghost"] },
            ];
        return { data: data as T, model: "fake", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, cached: false };
      },
    };
    const { intentSet, report } = await mineIntents({ ...base, batchSize: 100 }, llm, "fake");
    expect(intentSet.intents.map((i) => i.id)).toEqual(["lead_size"]);
    expect(report.distinctNeeds).toBe(1);
  });
});

describe("estimateIntents", () => {
  test("marks the set estimated, with equal weights", async () => {
    const llm: JsonModel = {
      async generateJson<T>() {
        return {
          data: [
            { id: "Capacity", question: "How much does it hold?", kind: "spec", rubric: "answered: oz" },
            { id: "capacity", question: "dup", kind: "spec", rubric: "r" },
            { id: "leakproof", question: "Leak-proof?", kind: "claim", rubric: "r", conditional: false },
          ] as T,
          model: "fake",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
          cached: false,
        };
      },
    };
    const l = normalize({ source: "paste", requestedAsin: "B0BOTTLE01", fetchedAt: "t", data: { title: "Water Bottle 32 oz" } });
    const set = await estimateIntents({ categoryId: "water-bottles", categoryName: "Water Bottles", match: ["Water Bottles"], version: "e1", listings: [l] }, llm, "fake");
    expect(set).toMatchObject({ basis: "estimated", reviewed: false, sampleSize: 0 });
    expect(set.intents.map((i) => [i.id, i.frequency])).toEqual([
      ["capacity", 1],
      ["leakproof", 1],
    ]);
  });
});

describe("resolveIntentSet", () => {
  const set = (categoryId: string, match: string[]): IntentSet => ({ categoryId, categoryName: categoryId, match, version: "v", basis: "mined", reviewed: true, sampleSize: 1, intents: [] });
  const sets = [set("office", ["Office Products"]), set("gel", ["Gel Ink Rollerball Pens"])];
  const withPath = (categories: string[]): Listing => {
    const l = normalize({ source: "paste", requestedAsin: "B0X0000001", fetchedAt: "t", data: { title: "x" } });
    return { ...l, meta: { ...l.meta, categories } };
  };

  test("prefers the deepest matching category", () => {
    expect(resolveIntentSet(withPath(["Office Products", "Pens", "Gel Ink Rollerball Pens"]), sets)?.categoryId).toBe("gel");
  });

  test("falls back up the path, and returns null when nothing matches", () => {
    expect(resolveIntentSet(withPath(["Office Products", "Mechanical Pencils"]), sets)?.categoryId).toBe("office");
    expect(resolveIntentSet(withPath(["Kitchen", "Water Bottles"]), sets)).toBeNull();
  });
});
