import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFaithfulness, draftBriefs, verifyBriefs } from "./briefs";
import { computeGaps, type GradedListing } from "./gaps";
import { gradeListing } from "./grade";
import { checkCoverage, collectClaims, findHiddenAnswers } from "./images";
import type { JsonModel, JsonRequest } from "./llm";
import { normalize } from "./normalize";
import type { Brief, Gap, Grade, ImageClaim, Intent, IntentSet, Listing, Quote } from "./types";

const ROOT = join(import.meta.dir, "../../..");
const intentSet = JSON.parse(readFileSync(join(ROOT, "fixtures/intents/gel-ink-pens.json"), "utf8")) as IntentSet;

const intents: Intent[] = [
  { id: "ink_flow", kind: "claim", question: "Does it skip?", rubric: "", frequency: 171 },
  { id: "tip_size", kind: "spec", question: "What tip size?", rubric: "", frequency: 130 },
  { id: "pack_contents", kind: "spec", question: "How many pens?", rubric: "", frequency: 39 },
  { id: "scent", kind: "spec", question: "Scented?", rubric: "", frequency: 15, conditional: true },
  { id: "smoothness", kind: "experience", question: "Smooth?", rubric: "", frequency: 234 },
];

const paste = (asin: string, data: object): Listing => normalize({ source: "paste", requestedAsin: asin, fetchedAt: "t", data });
const g = (intentId: string, status: Grade["status"], quotes: Quote[] = []): Grade => ({ intentId, status, quotes, modelStatus: status, flags: [] });

const target = paste("B0TARGET01", { title: "Acme Gel Pens, 6 Count", bullets: ["Quick dry ink"], description: "Includes 4 pens." });
const rival = (asin: string, grades: Grade[]): GradedListing => ({ listing: paste(asin, { title: `Rival ${asin}` }), grades });

describe("computeGaps", () => {
  const targetGrades = [g("ink_flow", "missing"), g("tip_size", "partial"), g("pack_contents", "contradicted", [{ fieldId: "title", text: "6 Count" }, { fieldId: "description.1", text: "Includes 4 pens" }]), g("scent", "not_applicable"), g("smoothness", "missing")];
  const rivals = [
    rival("B0RIVAL001", [g("ink_flow", "answered", [{ fieldId: "bullet.1", text: "never skips" }]), g("tip_size", "answered", [{ fieldId: "title", text: "0.7mm" }])]),
    rival("B0RIVAL002", [g("ink_flow", "partial", [{ fieldId: "bullet.2", text: "smooth flow" }]), g("tip_size", "missing")]),
  ];

  test("ranks by frequency × gain × (0.5 + 0.5 × competitor share)", () => {
    const gaps = computeGaps({ listing: target, grades: targetGrades }, rivals, intents);
    // ink_flow: 171 × 1 × (0.5 + 0.5 × 0.75) = 149.6; tip_size: 130 × 0.5 × (0.5 + 0.5 × 0.5) = 48.75
    // pack_contents: 39 × 1 × (0.5 + 0) = 19.5 (no rival graded it)
    expect(gaps.map((x) => [x.intentId, x.priority])).toEqual([
      ["ink_flow", 149.6],
      ["tip_size", 48.8],
      ["pack_contents", 19.5],
    ]);
    expect(gaps[0]!.competitorShare).toBe(0.75);
    expect(gaps[0]!.competitorsAnswering.map((c) => c.quote.text)).toEqual(["never skips", "smooth flow"]);
  });

  test("leaves out answered, not-applicable and experience questions", () => {
    const gaps = computeGaps({ listing: target, grades: [g("tip_size", "answered"), g("scent", "not_applicable"), g("smoothness", "missing")] }, rivals, intents);
    expect(gaps).toEqual([]);
  });

  test("keeps a common question even when no competitor answers it", () => {
    const gaps = computeGaps({ listing: target, grades: [g("ink_flow", "missing")] }, [], intents);
    expect(gaps[0]).toMatchObject({ competitorShare: null, priority: 85.5 });
  });
});

const gap = (intentId: string, status: Gap["status"], hiddenClaims: ImageClaim[] = []): Gap => ({
  intentId,
  status,
  frequency: 100,
  competitorShare: 0.5,
  competitorsAnswering: [],
  hiddenClaims,
  priority: 50,
});

describe("verifyBriefs", () => {
  const claims: ImageClaim[] = [{ id: "ic.0", text: "Smooth Writing without Skipping", imageIds: ["img.2"] }];

  test("never picks a side in a contradiction: it asks the brand", () => {
    const grades = [g("pack_contents", "contradicted", [{ fieldId: "title", text: "6 Count" }, { fieldId: "description.1", text: "Includes 4 pens" }])];
    const [b] = verifyBriefs(target, [gap("pack_contents", "contradicted")], grades, [], intents, []);
    expect(b).toMatchObject({ action: "fix_contradiction", target: "title" });
    expect(b!.draft).toBeUndefined();
    expect(b!.needsFromBrand).toContain('"6 Count" (title) or "Includes 4 pens" (description.1)');
  });

  test("an answer hidden in an image is moved word for word, whatever the model drafted", () => {
    const [b] = verifyBriefs(target, [gap("ink_flow", "missing", claims)], [], claims, intents, [
      { intentId: "ink_flow", target: "bullet.1", draft: "Smooth writing without skipping for an effortless experience", sources: [{ id: "ic.0", text: "Smooth Writing without Skipping" }] },
    ]);
    expect(b).toMatchObject({ action: "move_from_image", target: "bullet.1", draft: "Smooth Writing without Skipping", sources: [{ kind: "image", id: "ic.0" }] });
  });

  test("drops a draft with a number the sources don't contain", () => {
    const [b] = verifyBriefs(target, [gap("tip_size", "missing")], [], [], intents, [
      { intentId: "tip_size", target: "new_bullet", draft: "Fine 0.7mm tip", sources: [{ id: "title", text: "Acme Gel Pens" }] },
    ]);
    expect(b).toMatchObject({ action: "request_fact", flags: ["unsourced_number"] });
    expect(b!.draft).toBeUndefined();
  });

  test("drops sources that aren't really in the listing, then the draft with no source left", () => {
    const [b] = verifyBriefs(target, [gap("tip_size", "missing")], [], [], intents, [
      { intentId: "tip_size", target: "new_bullet", draft: "Fine tip", sources: [{ id: "bullet.1", text: "Fine point tip" }] },
    ]);
    expect(b!.flags).toEqual(["source_not_found", "no_brand_source"]);
    expect(b!.action).toBe("request_fact");
  });

  test("replaces a made-up target with new_bullet", () => {
    const [b] = verifyBriefs(target, [gap("ink_flow", "missing")], [], [], intents, [
      { intentId: "ink_flow", target: "bullet.9", draft: "Quick dry ink for everyday writing", sources: [{ id: "bullet.1", text: "Quick dry ink" }] },
    ]);
    expect(b).toMatchObject({ target: "new_bullet", action: "add_bullet", flags: ["invalid_target"] });
  });

  test("drops a draft that is word for word an existing field", () => {
    const [b] = verifyBriefs(target, [gap("ink_flow", "missing")], [], [], intents, [
      { intentId: "ink_flow", target: "new_bullet", draft: "Quick dry ink", sources: [{ id: "bullet.1", text: "Quick dry ink" }] },
    ]);
    expect(b).toMatchObject({ action: "request_fact", flags: ["repeats_field"] });
  });

  test("falls back to the brand's exact image words when the model gives no usable draft", () => {
    const [b] = verifyBriefs(target, [gap("ink_flow", "missing", claims)], [], claims, intents, []);
    expect(b).toMatchObject({ action: "move_from_image", draft: "Smooth Writing without Skipping", flags: ["not_drafted"] });
  });
});

describe("applyFaithfulness", () => {
  const hidden: ImageClaim = { id: "ic.0", text: "No Smear: Perfect for Left-Handed", imageIds: ["img.8"] };
  const briefs: Brief[] = [
    { intentId: "a", question: "Lefties?", action: "move_from_image", target: "new_bullet", draft: "No smear for lefties, and dries in a second", sources: [{ kind: "image", id: "ic.0", text: hidden.text }], priority: 1, flags: [] },
    { intentId: "b", question: "Leaks?", action: "add_bullet", target: "new_bullet", draft: "Sealed with wax to prevent drying and leaking", sources: [{ kind: "image", id: "ic.1", text: "Sealed with wax to prevent drying" }], priority: 1, flags: [] },
    { intentId: "c", question: "Tip?", action: "edit_field", target: "title", draft: "0.5mm tip", sources: [{ kind: "field", id: "title", text: "0.5mm" }], priority: 1, flags: [] },
  ];
  const gaps = [gap("a", "partial", [hidden]), gap("b", "missing"), gap("c", "missing")];

  test("an image-based draft with extra claims falls back to the brand's exact image words", () => {
    const [a] = applyFaithfulness(briefs, gaps, [{ intentId: "a", unsupported: ["dries in a second"] }]);
    expect(a).toMatchObject({ draft: hidden.text, action: "move_from_image", flags: ["unsupported_claim"], rejectedStatements: ["dries in a second"] });
  });

  test("any other draft with extra claims becomes a request to the brand", () => {
    const [, b] = applyFaithfulness(briefs, gaps, [{ intentId: "b", unsupported: ["and leaking"] }]);
    expect(b).toMatchObject({ action: "request_fact", flags: ["unsupported_claim"], rejectedStatements: ["and leaking"] });
    expect(b!.draft).toBeUndefined();
  });

  test("drops a draft that doesn't answer its question, even if every word is sourced", () => {
    const [, , c] = applyFaithfulness(briefs, gaps, [{ intentId: "c", unsupported: [], answersQuestion: false }]);
    expect(c).toMatchObject({ action: "request_fact", flags: ["off_question"] });
    expect(c!.rejectedStatements).toBeUndefined();
  });

  test("leaves supported drafts alone", () => {
    const [, , c] = applyFaithfulness(briefs, gaps, [{ intentId: "c", unsupported: [] }]);
    expect(c).toEqual(briefs[2]!);
  });
});

describe("recorded hero fix list", () => {
  test("puts the hidden 'without skipping' claim first and holds back invented claims", async () => {
    const llm = recordedLlm();
    const load = (asin: string) => normalize({ source: "serpapi", requestedAsin: asin, fetchedAt: "t", data: JSON.parse(readFileSync(join(ROOT, "fixtures/serpapi", `${asin}.json`), "utf8")) });
    const hero = load("B0C9W8DD9S");
    const grades = (await gradeListing(hero, intentSet, llm, "gemini-3.5-flash-lite")).grades;
    const claims = collectClaims(hero, JSON.parse(readFileSync(join(ROOT, "fixtures/image-claims/serpapi/B0C9W8DD9S.json"), "utf8")).modelOutput);
    const hidden = findHiddenAnswers(grades, claims, (await checkCoverage(hero, claims, intentSet.intents, llm, "gemini-3.5-flash-lite")).matches, intentSet.intents);
    const rivals: GradedListing[] = [];
    for (const f of readdirSync(join(ROOT, "fixtures/serpapi")).filter((x) => !x.startsWith("B0C9W8DD9S"))) {
      const l = load(f.replace(".json", ""));
      rivals.push({ listing: l, grades: (await gradeListing(l, intentSet, llm, "gemini-3.5-flash-lite")).grades });
    }
    const gaps = computeGaps({ listing: hero, grades }, rivals, intentSet.intents, hidden);
    const { briefs } = await draftBriefs(hero, gaps, grades, claims, intentSet.intents, llm, "gemini-3.5-flash-lite");

    expect(briefs[0]).toMatchObject({ intentId: "ink_flow", action: "move_from_image", draft: "Smooth Writing without Skipping" });
    const leaking = briefs.find((b) => b.intentId === "leaking")!;
    expect(leaking.action).toBe("request_fact");
    expect(leaking.rejectedStatements).toEqual(["and leaking"]);
    expect(briefs.every((b) => !b.draft || !/leak/i.test(b.draft))).toBe(true);
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
