import { describe, expect, test } from "bun:test";
import type { JsonModel, JsonRequest } from "./llm";
import type { ReviewText } from "./mine";
import {
  checkProof,
  claimKeywords,
  dedupeReviews,
  exampleText,
  listingClaims,
  mentions,
  MIN_EVIDENCE,
  sampleForClaim,
  summarize,
  verifyLabels,
  wilson,
  type ListingClaim,
  type ProofLabel,
} from "./proof";
import type { ClaimMatch, Grade, ImageClaim, Intent } from "./types";

const review = (text: string, helpfulVotes = 0): ReviewText => ({ asin: "B0TEST0001", title: "", text, helpfulVotes });
const intents: Intent[] = [
  { id: "smudge", kind: "claim", question: "Does the ink smudge or smear?", rubric: "", frequency: 84 },
  { id: "leaking", kind: "claim", question: "Does the pen leak or blob?", rubric: "", frequency: 29 },
  { id: "tip_size", kind: "spec", question: "What tip size?", rubric: "", frequency: 130 },
  { id: "smoothness", kind: "experience", question: "Smooth?", rubric: "", frequency: 234 },
];
const smudgeClaim: ListingClaim = { intentId: "smudge", sources: [{ kind: "field", id: "bullet.2", text: "no smears, no smudges" }] };

/** Labels by keyword so tests can control the outcome, and records every request it gets. */
function fakeLabeller(): JsonModel & { requests: JsonRequest[] } {
  const requests: JsonRequest[] = [];
  return {
    requests,
    async generateJson<T>(req: JsonRequest) {
      requests.push(req);
      const text = "text" in req.parts[0]! ? req.parts[0].text : "";
      const data = [...text.matchAll(/^\[(\d+)\] (.*)$/gm)].map(([, i, body]) => ({
        i: Number(i),
        label: /still smears/.test(body!) ? "contradicts" : /glossy/.test(body!) ? "mixed" : /never smudges/.test(body!) ? "supports" : "unrelated",
      }));
      return { data: data as T, model: "fake", usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 0, cached: false };
    },
  };
}

describe("wilson", () => {
  test("matches the textbook values", () => {
    const a = wilson(4, 40);
    expect(a.rate).toBe(0.1);
    expect(a.low).toBeCloseTo(0.0396, 3);
    expect(a.high).toBeCloseTo(0.2305, 3);
    const b = wilson(50, 100);
    expect(b.low).toBeCloseTo(0.4038, 3);
    expect(b.high).toBeCloseTo(0.5962, 3);
  });

  test("stays inside 0..1 at the edges, where the plain normal interval doesn't", () => {
    const none = wilson(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775, 3);
    const all = wilson(10, 10);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.7225, 3);
    // 2 of 60: p - 1.96·√(p(1-p)/n) is below zero; Wilson isn't.
    expect(wilson(2, 60).low).toBeGreaterThan(0);
  });

  test("refuses impossible input", () => {
    expect(() => wilson(1, 0)).toThrow();
    expect(() => wilson(5, 4)).toThrow();
  });
});

describe("finding reviews about a claim", () => {
  test("terms match at the start of a word, across hyphens and case", () => {
    expect(mentions(review("As a Left-Handed writer..."), claimKeywords({ id: "smudge_left_handed" }))).toBe(true);
    expect(mentions(review("It SMUDGED everywhere"), claimKeywords({ id: "smudge" }))).toBe(true);
    expect(mentions(review("No smudging at all"), ["smudg"])).toBe(true);
    // "skip" must not match inside another word.
    expect(mentions(review("I was skeptical but it's fine"), ["skip"])).toBe(false);
    expect(mentions(review("great colors"), claimKeywords({ id: "smudge" }))).toBe(false);
  });

  test("the title counts too", () => {
    expect(mentions({ title: "Leaks everywhere", text: "Disappointed." }, claimKeywords({ id: "leaking" }))).toBe(true);
  });

  test("an unknown claim falls back to the words of its id", () => {
    expect(claimKeywords({ id: "leak_proof" })).toEqual(["leak", "proof"]);
    expect(claimKeywords({ id: "fits_in_cup_holder" })).toEqual(["fits", "cup", "holder"]);
  });

  test("the sample is capped, the same every run, and doesn't depend on input order", () => {
    const reviews = Array.from({ length: 300 }, (_, i) => review(`review ${i} smudge`));
    const a = sampleForClaim("smudge", reviews, 150);
    const b = sampleForClaim("smudge", [...reviews].reverse(), 150);
    expect(a).toHaveLength(150);
    expect(a.map((r) => r.text)).toEqual(b.map((r) => r.text));
    // Seeded by claim: another claim draws a different sample from the same reviews.
    expect(sampleForClaim("leaking", reviews, 150).map((r) => r.text)).not.toEqual(a.map((r) => r.text));
  });

  test("identical reviews count once, keeping the most helpful copy", () => {
    const out = dedupeReviews([review("smudges", 1), review("smudges", 7), review("never smudges", 2), { ...review("smudges", 7), rating: 5 }]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.text === "smudges")).toMatchObject({ helpfulVotes: 7, rating: 5 });
  });

  test("duplicates that reach the sampler are ordered by helpful votes then rating, whatever the input order", () => {
    const dupes = [{ ...review("same text", 1), rating: 2 }, { ...review("same text", 9), rating: 1 }, { ...review("same text", 9), rating: 4 }];
    const a = sampleForClaim("smudge", dupes, 3);
    const b = sampleForClaim("smudge", [...dupes].reverse(), 3);
    expect(a).toEqual(b);
    expect(a.map((r) => [r.helpfulVotes, r.rating])).toEqual([[9, 4], [9, 1], [1, 2]]);
  });

  test("checkProof counts a doubled review once", async () => {
    const llm = fakeLabeller();
    const reviews = Array.from({ length: 29 }, (_, i) => review(`never smudges ${i}`));
    const run = await checkProof([smudgeClaim], intents, [...reviews, review("never smudges 0")], llm, "fake");
    expect(run.reviews).toBe(29);
    expect(run.claims[0]).toMatchObject({ matching: 29, verdict: "not_enough_evidence" });
    expect(llm.requests).toHaveLength(0);
  });

  test("examples start near the keyword in a long review", () => {
    const long = review(`${"I love the colors and the grip and the clip. ".repeat(8)}Sadly it still smears on my hand.`);
    const ex = exampleText(long, ["smear"]);
    expect(ex.startsWith("…")).toBe(true);
    expect(ex).toContain("still smears");
    expect(ex.length).toBeLessThanOrEqual(222);
  });
});

describe("listingClaims", () => {
  const grades: Grade[] = [
    { intentId: "smudge", status: "answered", quotes: [{ fieldId: "bullet.2", text: "no smears" }], modelStatus: "answered", flags: [] },
    { intentId: "leaking", status: "missing", quotes: [], modelStatus: "missing", flags: [] },
    { intentId: "tip_size", status: "answered", quotes: [{ fieldId: "title", text: "0.7mm" }], modelStatus: "answered", flags: [] },
  ];
  const imageClaims: ImageClaim[] = [
    { id: "c1", text: "Leak-proof design", imageIds: ["img.3"] },
    { id: "c2", text: "No smears", imageIds: ["img.1"] },
  ];
  const coverage: ClaimMatch[] = [
    { claimId: "c1", coverage: "image_only", quotes: [], intentId: "leaking", flags: [] },
    { claimId: "c2", coverage: "in_text", quotes: [], intentId: "smudge", flags: [] },
  ];

  test("claims come from verified text grades and from image claims; specs are left out", () => {
    const claims = listingClaims(grades, intents, imageClaims, coverage);
    expect(claims.map((c) => c.intentId)).toEqual(["smudge", "leaking"]);
    // The image says the same words as the text, so it's listed once.
    expect(claims[0]!.sources).toEqual([{ kind: "field", id: "bullet.2", text: "no smears" }]);
    expect(claims[1]!.sources).toEqual([{ kind: "image", id: "img.3", text: "Leak-proof design" }]);
  });

  test("warranty and guarantee lines aren't claims reviews can test", () => {
    const withPolicy: Grade[] = [
      { intentId: "smudge", status: "answered", quotes: [{ fieldId: "bullet.4", text: "Backed by a Limited Lifetime Warranty" }, { fieldId: "bullet.2", text: "no smears" }], modelStatus: "answered", flags: [] },
      { intentId: "leaking", status: "answered", quotes: [{ fieldId: "bullet.5", text: "100% money-back guarantee" }], modelStatus: "answered", flags: [] },
    ];
    const claims = listingClaims(withPolicy, intents, [], []);
    expect(claims.map((c) => c.intentId)).toEqual(["smudge"]);
    expect(claims[0]!.sources).toEqual([{ kind: "field", id: "bullet.2", text: "no smears" }]);
  });
});

describe("verifyLabels (garbled model output)", () => {
  test("keeps only in-batch indexes and known labels; the first label for a review wins", () => {
    const out = verifyLabels(
      [
        { i: 10, label: "supports" },
        { i: 11, label: "contradicts" },
        { i: 11, label: "supports" },
        { i: 3, label: "supports" },
        { i: 14, label: "mostly true" },
        { i: 12.5, label: "mixed" },
        { i: "12", label: "mixed" },
        null,
        "junk",
      ],
      10,
      5,
    );
    expect(out.labels).toEqual(["supports", "contradicts", null, null, null]);
    expect(out.flags.sort()).toEqual(["bad_index", "bad_label", "duplicate_label", "unlabelled_reviews"]);
  });

  test("an answer that isn't a list labels nothing", () => {
    expect(verifyLabels({ labels: "all supports" }, 0, 3)).toEqual({ labels: [null, null, null], flags: ["unlabelled_reviews"] });
  });
});

describe("summarize", () => {
  const sampleOf = (n: number) => Array.from({ length: n }, (_, i) => review(`r${i}`, i));
  const labelsOf = (counts: Partial<Record<ProofLabel | "none", number>>) =>
    (Object.entries(counts) as [ProofLabel | "none", number][]).flatMap(([l, n]) => Array.from({ length: n }, () => (l === "none" ? null : l)));

  test("under 30 matching reviews: not enough evidence and no rate", () => {
    const p = summarize(smudgeClaim, ["smudg"], 12, [], [], []);
    expect(p.verdict).toBe("not_enough_evidence");
    expect(p.contradiction).toBeUndefined();
  });

  test("keyword hits that turn out unrelated don't count as evidence", () => {
    const labels = labelsOf({ supports: 20, contradicts: 2, unrelated: 40 });
    const p = summarize(smudgeClaim, ["smudg"], 62, sampleOf(62), labels, []);
    expect(p.verdict).toBe("not_enough_evidence");
    expect(p.counts).toEqual({ supports: 20, contradicts: 2, mixed: 0, unrelated: 40, unlabelled: 0 });
  });

  test("rates are over reviews that discuss the claim; mixed is reported but doesn't contest", () => {
    const labels = labelsOf({ supports: 90, contradicts: 3, mixed: 20, unrelated: 10, none: 2 });
    const p = summarize(smudgeClaim, ["smudg"], 400, sampleOf(125), labels, ["unlabelled_reviews"]);
    expect(p.contradiction!.rate).toBeCloseTo(3 / 113, 6);
    expect(p.mixed!.rate).toBeCloseTo(20 / 113, 6);
    expect(p.contradiction!.low).toBeLessThan(0.05);
    expect(p.verdict).toBe("backed");
    expect(p.counts.unlabelled).toBe(2);
  });

  test("contested once the lower bound of the contradiction rate reaches 5%", () => {
    // 12 of 100: Wilson lower bound ≈ 7.0%.
    const p = summarize(smudgeClaim, ["smudg"], 300, sampleOf(100), labelsOf({ supports: 88, contradicts: 12 }), []);
    expect(p.contradiction!.low).toBeGreaterThan(0.05);
    expect(p.verdict).toBe("contested");
    // 5 of 100 is 5%, but its lower bound (≈2.2%) isn't: too few to rule out noise.
    expect(summarize(smudgeClaim, ["smudg"], 300, sampleOf(100), labelsOf({ supports: 95, contradicts: 5 }), []).verdict).toBe("backed");
  });

  test("examples are the most helpful reviews, three at most", () => {
    const sample = sampleOf(40);
    const p = summarize(smudgeClaim, ["smudg"], 40, sample, labelsOf({ supports: 40 }), []);
    expect(p.examples.supports).toEqual(["r39", "r38", "r37"].map((t) => `. ${t}`));
  });

  test("reviews short enough to show whole come before long ones, and a repeated text shows once", () => {
    const long = review(`Writes smooth without blobbing. ${"I use these daily at work for notes. ".repeat(6)}This pack skips constantly.`, 99);
    const sample = [long, review("Skips a lot.", 3), review("Skips a lot.", 2), review("Stopped writing after a day.", 1)];
    const p = summarize(smudgeClaim, ["skip"], 40, sample, labelsOf({ contradicts: 4 }), []);
    expect(p.examples.contradicts).toEqual([". Skips a lot.", ". Stopped writing after a day.", expect.stringContaining("…")]);
  });
});

describe("checkProof (fake model)", () => {
  test("a claim with too few matching reviews makes no model call", async () => {
    const llm = fakeLabeller();
    const reviews = [review("never smudges"), review("still smears"), ...Array.from({ length: 200 }, (_, i) => review(`lovely colors ${i}`))];
    const run = await checkProof([smudgeClaim], intents, reviews, llm, "fake");
    expect(llm.requests).toHaveLength(0);
    expect(run.claims[0]).toMatchObject({ intentId: "smudge", matching: 2, sampled: 0, verdict: "not_enough_evidence" });
  });

  test("samples 150 of the matches, labels them in two equal batches, and counts in code", async () => {
    const llm = fakeLabeller();
    const reviews = [
      ...Array.from({ length: 160 }, (_, i) => review(`never smudges, pen ${i}`)),
      ...Array.from({ length: 30 }, (_, i) => review(`still smears, pen ${i}`)),
      ...Array.from({ length: 10 }, (_, i) => review(`smudges on glossy paper, pen ${i}`)),
    ];
    const run = await checkProof([smudgeClaim], intents, reviews, llm, "fake");
    expect(llm.requests).toHaveLength(2);
    const sizes = llm.requests.map((r) => ("text" in r.parts[0]! ? r.parts[0].text : "").match(/^\[\d+\]/gm)!.length);
    expect(sizes).toEqual([75, 75]);
    const p = run.claims[0]!;
    expect(p.matching).toBe(200);
    expect(p.sampled).toBe(150);
    expect(p.counts.supports + p.counts.contradicts + p.counts.mixed).toBe(150);
    expect(p.counts.contradicts).toBeGreaterThan(MIN_EVIDENCE / 3);
    expect(p.verdict).toBe("contested");
    expect(run.usage.requests).toBe(2);
  });

  test("the prompt carries the claim's topic, the listing's words and cleaned review text", async () => {
    const llm = fakeLabeller();
    const reviews = Array.from({ length: 30 }, (_, i) => review(`never smudges &#34;really&#34;<br />pen ${i}`));
    await checkProof([smudgeClaim], intents, reviews, llm, "fake");
    const prompt = "text" in llm.requests[0]!.parts[0]! ? llm.requests[0]!.parts[0].text : "";
    expect(prompt).toContain("TOPIC: Does the ink smudge or smear?");
    expect(prompt).toContain('THE LISTING SAYS: "no smears, no smudges"');
    expect(prompt).toContain('never smudges "really" pen');
    expect(prompt).not.toContain("<br");
  });
});
