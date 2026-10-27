import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../normalize";
import { scoreGrades } from "../score";
import type { Grade, Intent, IntentSet, Listing } from "../types";
import { gradeListing, type JsonModel } from "./index";
import { bestSubstringDistance, quoteMatches } from "./match";
import { buildGradePrompt } from "./prompt";
import { verifyGrades } from "./verify";

const ROOT = join(import.meta.dir, "../../../..");
const intentSet = JSON.parse(readFileSync(join(ROOT, "fixtures/intents/gel-ink-pens.json"), "utf8")) as IntentSet;

const listing = normalize({
  source: "paste",
  requestedAsin: "B0TEST0001",
  fetchedAt: "t",
  data: {
    title: "Gel Pens, 0.5mm Fine Point, 6 Count",
    bullets: ["Quick-drying ink won't smudge, great for left-handed writers", "Refillable with G2 refills"],
    description: "Includes 4 pens in black ink.",
    attributes: { "Closure Type": "Retractable" },
  },
});

const intents: Intent[] = [
  { id: "tip_size", kind: "spec", question: "Tip size?", rubric: "", frequency: 100 },
  { id: "smudge", kind: "claim", question: "Smudge?", rubric: "", frequency: 50 },
  { id: "pack_contents", kind: "spec", question: "How many?", rubric: "", frequency: 30 },
  { id: "scent", kind: "spec", question: "Scent?", rubric: "", frequency: 10, conditional: true },
  { id: "leaking", kind: "claim", question: "Leak?", rubric: "", frequency: 20 },
  { id: "smoothness", kind: "experience", question: "Smooth?", rubric: "", frequency: 200 },
];

const grade = (grades: Grade[], id: string) => grades.find((g) => g.intentId === id)!;

describe("quoteMatches", () => {
  test("accepts exact quotes regardless of case, spacing and curly quotes", () => {
    expect(quoteMatches("quick-drying   INK", "Quick-drying ink won’t smudge")).toBe(true);
    expect(quoteMatches("won't smudge", "Quick-drying ink won’t smudge")).toBe(true);
  });

  test("accepts a typo-level difference in a long quote", () => {
    expect(quoteMatches("Quick drying ink won't smudge, great for left handed", listing.fields[1]!.text)).toBe(true);
  });

  test("rejects a short quote with any difference", () => {
    expect(quoteMatches("0.7mm", "Gel Pens, 0.5mm Fine Point")).toBe(false);
  });

  test("rejects a paraphrase", () => {
    expect(quoteMatches("dries fast and never smears", listing.fields[1]!.text)).toBe(false);
  });

  test("rejects quotes too short to mean anything", () => {
    expect(quoteMatches("ok", "ok then")).toBe(false);
  });

  test("substring distance is 0 for a contained string and counts edits otherwise", () => {
    expect(bestSubstringDistance("fine", "gel pens fine point")).toBe(0);
    expect(bestSubstringDistance("fyne", "gel pens fine point")).toBe(1);
  });
});

describe("verifyGrades", () => {
  test("keeps an answer whose quote is in the cited field", () => {
    const g = verifyGrades(listing, intents, [{ intentId: "tip_size", status: "answered", quotes: [{ fieldId: "title", text: "0.5mm Fine Point" }], value: "0.5mm" }]);
    expect(grade(g, "tip_size")).toMatchObject({ status: "answered", value: "0.5mm", flags: [] });
  });

  test("turns an answer with an invented quote into missing, and flags it", () => {
    const g = verifyGrades(listing, intents, [{ intentId: "leaking", status: "answered", quotes: [{ fieldId: "bullet.1", text: "Leak-proof design" }] }]);
    expect(grade(g, "leaking")).toMatchObject({ status: "missing", modelStatus: "answered", quotes: [] });
    expect(grade(g, "leaking").flags).toEqual(["quote_not_found", "unverified_answer"]);
  });

  test("moves a real quote to the field it's actually in", () => {
    const g = verifyGrades(listing, intents, [{ intentId: "smudge", status: "answered", quotes: [{ fieldId: "title", text: "won't smudge" }] }]);
    expect(grade(g, "smudge").quotes).toEqual([{ fieldId: "bullet.1", text: "won't smudge" }]);
    expect(grade(g, "smudge").flags).toEqual(["quote_field_corrected"]);
  });

  test("accepts a contradiction quoted from two fields", () => {
    const g = verifyGrades(listing, intents, [
      { intentId: "pack_contents", status: "contradicted", quotes: [{ fieldId: "title", text: "6 Count" }, { fieldId: "description.1", text: "Includes 4 pens" }] },
    ]);
    expect(grade(g, "pack_contents").status).toBe("contradicted");
  });

  test("downgrades a contradiction with only one verified side to answered", () => {
    const g = verifyGrades(listing, intents, [
      { intentId: "pack_contents", status: "contradicted", quotes: [{ fieldId: "title", text: "6 Count" }, { fieldId: "bullet.2", text: "Pack of 12" }] },
    ]);
    expect(grade(g, "pack_contents")).toMatchObject({ status: "answered", quotes: [{ fieldId: "title", text: "6 Count" }] });
    expect(grade(g, "pack_contents").flags).toContain("unverified_contradiction");
  });

  test("sets aside a conditional question the listing doesn't address, instead of counting it missing", () => {
    const g = verifyGrades(listing, intents, [{ intentId: "scent", status: "missing", quotes: [] }]);
    expect(grade(g, "scent")).toMatchObject({ status: "not_applicable", modelStatus: "missing", flags: ["conditional_unaddressed"] });
  });

  test("only allows not_applicable for conditional questions", () => {
    const g = verifyGrades(listing, intents, [
      { intentId: "scent", status: "not_applicable", quotes: [] },
      { intentId: "leaking", status: "not_applicable", quotes: [] },
    ]);
    expect(grade(g, "scent").status).toBe("not_applicable");
    expect(grade(g, "leaking")).toMatchObject({ status: "missing", flags: ["not_applicable_rejected"] });
  });

  test("grades every question once, even ones the model skipped or garbled", () => {
    const g = verifyGrades(listing, intents, [
      { intentId: "tip_size", status: "answered", quotes: [{ fieldId: "title", text: "0.5mm" }] },
      { intentId: "tip_size", status: "missing", quotes: [] },
      { intentId: "smudge", status: "maybe", quotes: [] },
      { intentId: "made_up_intent", status: "answered", quotes: [] },
    ]);
    expect(g.map((x) => x.intentId)).toEqual(["tip_size", "smudge", "pack_contents", "scent", "leaking"]);
    expect(grade(g, "tip_size").status).toBe("answered");
    expect(grade(g, "smudge")).toMatchObject({ status: "missing", flags: ["not_graded"] });
  });

  test("never grades experience questions", () => {
    const g = verifyGrades(listing, intents, []);
    expect(g.some((x) => x.intentId === "smoothness")).toBe(false);
  });

  test("survives output that isn't an array", () => {
    expect(verifyGrades(listing, intents, { oops: true }).every((g) => g.status === "missing")).toBe(true);
  });
});

describe("scoreGrades", () => {
  const make = (intentId: string, status: Grade["status"]): Grade => ({ intentId, status, quotes: [], modelStatus: status, flags: [] });

  test("weights by frequency: answered 1, partial 0.5, missing and contradicted 0", () => {
    const s = scoreGrades([make("tip_size", "answered"), make("smudge", "partial"), make("pack_contents", "contradicted"), make("leaking", "missing")], intents);
    // (100×1 + 50×0.5 + 30×0 + 20×0) / 200 = 62.5
    expect(s.score).toBe(63);
    expect(s).toMatchObject({ answered: 1, partial: 1, contradicted: 1, missing: 1, counted: 4 });
  });

  test("leaves not-applicable questions out of the denominator", () => {
    const s = scoreGrades([make("tip_size", "answered"), make("scent", "not_applicable")], intents);
    expect(s).toMatchObject({ score: 100, counted: 1, notApplicable: 1 });
  });

  test("ignores experience questions even if graded", () => {
    expect(scoreGrades([make("tip_size", "missing"), make("smoothness", "answered")], intents).score).toBe(0);
  });

  test("is null when nothing counts", () => {
    expect(scoreGrades([], intents).score).toBeNull();
  });
});

describe("prompt", () => {
  test("lists fields with ids, marks conditional questions and leaves out experience ones", () => {
    const p = buildGradePrompt(listing, intents);
    expect(p).toContain("[title] Gel Pens, 0.5mm Fine Point, 6 Count");
    expect(p).toContain("- scent: Scent? [only some products]");
    expect(p).not.toContain("- smoothness:");
  });
});

describe("gradeListing", () => {
  test("sends one request and verifies the answer", async () => {
    const calls: unknown[] = [];
    const fake: JsonModel = {
      async generateJson<T>(req: unknown) {
        calls.push(req);
        return {
          data: [{ intentId: "tip_size", status: "answered", quotes: [{ fieldId: "title", text: "0.5mm" }] }] as T,
          model: "fake",
          usage: { inputTokens: 10, outputTokens: 5 },
          latencyMs: 1,
          cached: false,
        };
      },
    };
    const run = await gradeListing(listing, { ...intentSet, intents }, fake, "fake");
    expect(calls).toHaveLength(1);
    expect(grade(run.grades, "tip_size").status).toBe("answered");
    expect(grade(run.grades, "smudge").flags).toEqual(["not_graded"]);
  });
});

/**
 * Replays the real Gemini answers recorded in fixtures/llm. Locks in what the verifier does with
 * them, so a change to normalize, the prompt or the verifier that shifts a grade shows up here.
 */
describe("recorded audits", () => {
  const llm = loadRecordedLlm();
  const cases: [Exclude<Listing["source"], "paste">, string, number][] = [
    ["serpapi", "B0C9W8DD9S", 52],
    ["serpapi", "B001GAOTSW", 73],
    ["serpapi", "B097CF46RC", 73],
    ["serpapi", "B0BGPYR8Q3", 71],
    ["serpapi", "B0BSMKF5BQ", 55],
    ["dataset", "B09YP9YYZG", 61],
    ["dataset", "B097CF46RC", 61],
    ["dataset", "B0BSMKF5BQ", 57],
    ["dataset", "B0143LMAEK", 17],
    ["dataset", "B08CMWPFR1", 18],
  ];

  for (const [source, asin, expected] of cases) {
    test(`${source} ${asin} scores ${expected}`, async () => {
      const l = loadListing(source, asin);
      const run = await gradeListing(l, intentSet, llm, "gemini-3.5-flash-lite");
      expect(run.cached).toBe(true);
      expect(scoreGrades(run.grades, intentSet.intents).score).toBe(expected);
    });
  }

  test("finds the Uni-ball pack-size contradiction (6 in the title, 3 in the description)", async () => {
    const run = await gradeListing(loadListing("dataset", "B0143LMAEK"), intentSet, llm, "gemini-3.5-flash-lite");
    const g = grade(run.grades, "pack_contents");
    expect(g.status).toBe("contradicted");
    expect(g.quotes.map((q) => q.fieldId).sort()).toEqual(["description.1", "title"]);
  });

  test("finds the Pentel tip-size contradiction (1.0mm in the description, 0.7 in the attribute)", async () => {
    const run = await gradeListing(loadListing("dataset", "B097CF46RC"), intentSet, llm, "gemini-3.5-flash-lite");
    expect(grade(run.grades, "tip_size").status).toBe("contradicted");
  });
});

function loadListing(source: "dataset" | "serpapi", asin: string): Listing {
  const data = JSON.parse(readFileSync(join(ROOT, "fixtures", source, `${asin}.json`), "utf8"));
  return normalize({ source, requestedAsin: asin, fetchedAt: "t", data });
}

/**
 * A JsonModel that only answers from fixtures/llm. Core can't import providers, so this repeats
 * the cache key from providers' requestKey (text parts only). If the two drift, these tests fail.
 */
function loadRecordedLlm(): JsonModel {
  return {
    async generateJson<T>(req: { model: string; promptVersion: string; parts: { text: string }[]; schema: unknown; temperature?: number }) {
      const key = createHash("sha256")
        .update(JSON.stringify({ model: req.model, promptVersion: req.promptVersion, temperature: req.temperature ?? 0, schema: req.schema, parts: req.parts }))
        .digest("hex");
      const hit = JSON.parse(readFileSync(join(ROOT, "fixtures/llm", `${key}.json`), "utf8"));
      return { ...hit, data: hit.data as T, cached: true };
    },
  };
}
