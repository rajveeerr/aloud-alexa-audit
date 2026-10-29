import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CachedLlm } from "@answerable/providers";
import { AuditError, runAudit } from "./audit";
import { fsStores, parseReviewLines } from "./stores";

const ROOT = join(import.meta.dir, "../../..");
const stores = fsStores({ fixturesDir: join(ROOT, "fixtures"), imageCacheDir: "/tmp/answerable-test-images" });
const deps = { llm: new CachedLlm(null, join(ROOT, "fixtures/llm"), "replay"), vision: null, model: "gemini-3.5-flash-lite", ...stores, images: null };

describe("runAudit (replayed, no network)", () => {
  test("the hero: score, hidden answers, competitors and the fix list", async () => {
    const r = await runAudit({ asin: "B0C9W8DD9S", source: "serpapi" }, deps);
    expect(r.score.score).toBe(52);
    expect(r.intentSet.categoryId).toBe("gel-ink-pens");
    expect(r.hiddenAnswers.map((h) => h.intentId)).toEqual(["ink_flow", "smudge_left_handed"]);
    expect(r.competitors.map((c) => c.brand).sort()).toEqual(["BIC", "PILOT", "Pentel", "Sharpie"]);
    expect(r.briefs[0]).toMatchObject({ intentId: "ink_flow", action: "move_from_image", draft: "Smooth Writing without Skipping" });
    expect(r.usage.requests).toBe(r.usage.cachedRequests);
  });

  test("another category picks its own questions and notes they're unreviewed", async () => {
    const r = await runAudit({ asin: "B09VD1Z3TK", source: "dataset" }, deps);
    expect(r.intentSet.categoryId).toBe("dry-erase-boards");
    expect(r.score.score).toBe(84);
    expect(r.notes.some((n) => n.includes("haven't been reviewed"))).toBe(true);
  });

  test("an estimated category says so in the notes", async () => {
    const r = await runAudit({ asin: "B00P6N6LC2", source: "dataset" }, deps);
    expect(r.intentSet.basis).toBe("estimated");
    expect(r.notes.some((n) => n.includes("estimated"))).toBe(true);
  });

  test("promise vs proof on Pentel 2023: smudging complaints found but not enough to contest; leaking contested", async () => {
    const r = await runAudit({ asin: "B097CF46RC", source: "dataset" }, deps);
    const proof = r.proof!;
    expect(proof.reviews).toBe(400);
    const smudge = proof.claims.find((c) => c.intentId === "smudge")!;
    expect(smudge.sources[0]).toEqual({ kind: "field", id: "bullet.2", text: "no smears, no smudges, no globs" });
    expect(smudge.sampled).toBe(117);
    expect(smudge.counts.contradicts).toBeGreaterThan(0);
    expect(smudge.counts.mixed).toBeGreaterThan(0);
    expect(smudge.examples.contradicts).toHaveLength(3);
    expect(smudge.verdict).toBe("backed");
    const leaking = proof.claims.find((c) => c.intentId === "leaking")!;
    expect(leaking.verdict).toBe("contested");
    expect(leaking.contradiction!.low).toBeGreaterThanOrEqual(0.05);
  });

  test("a product with 5 reviews: every claim is not enough evidence, at no model cost", async () => {
    const r = await runAudit({ asin: "B0B42X682C", source: "dataset" }, deps);
    expect(r.proof!.claims.length).toBeGreaterThan(0);
    expect(r.proof!.claims.every((c) => c.verdict === "not_enough_evidence" && c.contradiction === undefined)).toBe(true);
    expect(r.proof!.usage.requests).toBe(0);
  });

  test("a live listing has no review text, and the notes say so", async () => {
    const r = await runAudit({ asin: "B097CF46RC", source: "serpapi" }, deps);
    expect(r.proof).toBeUndefined();
    expect(r.notes).toContain("Live listings come without review text, so promise vs proof wasn't checked.");
  });

  test("proof that can't run never fails the audit: a missing recording becomes a note", async () => {
    // Reviews nobody recorded labels for, as in the worker replaying without a key.
    const reviews = Array.from({ length: 40 }, (_, i) => ({ asin: "B097CF46RC", title: "", text: `smudges a bit, pen ${i}`, helpfulVotes: 0 }));
    const r = await runAudit({ asin: "B097CF46RC", source: "dataset" }, { ...deps, reviews: { get: async () => ({ reviews, badLines: 0 }) } });
    expect(r.proof).toBeUndefined();
    expect(r.score.score).not.toBeNull();
    expect(r.notes).toContain("Promise vs proof was skipped: its model answers aren't recorded, and live model calls are off.");
  });

  test("a review store that throws is skipped with a safe note, not the raw error", async () => {
    const r = await runAudit(
      { asin: "B097CF46RC", source: "dataset" },
      { ...deps, reviews: { get: async () => Promise.reject(new Error("EACCES /secret/path")) } },
    );
    expect(r.proof).toBeUndefined();
    expect(r.notes).toContain("Promise vs proof was skipped: an internal error.");
    expect(r.notes.join(" ")).not.toContain("/secret/path");
  });

  test("proof notes: none without a review store, the right wording per source otherwise", async () => {
    const { reviews: _, ...noReviews } = deps;
    const quiet = await runAudit({ asin: "B097CF46RC", source: "serpapi" }, noReviews);
    expect(quiet.notes.some((n) => n.includes("promise vs proof"))).toBe(false);

    // A model that answers every request with an empty list: enough to run a pasted listing offline.
    const empty = { generateJson: async <T>() => ({ data: [] as T, model: "fake", usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0, cached: true }) };
    const pasted = await runAudit({ asin: "B0PASTE001", source: "paste", paste: { title: "Acme Gel Pens, 6 Count" }, category: "Gel Ink Rollerball Pens" }, { ...deps, llm: empty });
    expect(pasted.notes).toContain("Pasted listings come without reviews, so promise vs proof wasn't checked.");

    const bottle = await runAudit({ asin: "B00P6N6LC2", source: "dataset" }, deps);
    expect(bottle.notes).toContain("No reviews are saved for this product, so promise vs proof wasn't checked.");
  });

  test("an unknown ASIN without live access is a clear error", async () => {
    await expect(runAudit({ asin: "B000000000", source: "serpapi" }, deps)).rejects.toBeInstanceOf(AuditError);
  });

  test("a paste without a title is a bad request", async () => {
    await expect(runAudit({ asin: "B0PASTE001", source: "paste" }, deps)).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("saved reviews", () => {
  test("a broken or empty line is skipped and counted, never thrown", () => {
    const text = ['{"r":5,"t":"Great","x":"never smudges","h":3}', '{"r":1,"t":"Bad","x":"smears', "", '{"r":3,"t":"","x":" "}', "not json", '{"x":"ok"}', '{"r":1,"t":"Broke in a week","x":" "}'].join("\n");
    const set = parseReviewLines("B0TEST0001", text);
    expect(set.badLines).toBe(3);
    expect(set.reviews).toEqual([
      { asin: "B0TEST0001", title: "Great", text: "never smudges", helpfulVotes: 3, rating: 5 },
      { asin: "B0TEST0001", title: "", text: "ok", helpfulVotes: 0 },
      // A title-only review is still a review.
      { asin: "B0TEST0001", title: "Broke in a week", text: " ", helpfulVotes: 0, rating: 1 },
    ]);
  });

  test("only dataset listings get saved reviews", async () => {
    expect((await stores.reviews.get("dataset", "B097CF46RC"))!.reviews).toHaveLength(400);
    expect(await stores.reviews.get("serpapi", "B097CF46RC")).toBeNull();
    expect(await stores.reviews.get("dataset", "B00P6N6LC2")).toBeNull();
  });
});

describe("saved listings", () => {
  test("come back sorted, whatever order the file system lists them in", async () => {
    const asins = await stores.listings.saved("dataset");
    expect(asins).toEqual([...asins].sort());
    expect(asins.length).toBeGreaterThan(10);
  });
});

describe("competitors", () => {
  test("one listing per competing brand", async () => {
    // Pilot is given twice. Without the brand rule the list would be Pilot, Pilot, Pentel, BIC.
    const r = await runAudit(
      { asin: "B0C9W8DD9S", source: "serpapi", competitors: ["B001GAOTSW", "B001GAOTSW", "B097CF46RC", "B0BGPYR8Q3", "B0BSMKF5BQ"] },
      deps,
    );
    expect(r.competitors.map((c) => c.brand)).toEqual(["PILOT", "Pentel", "BIC", "Sharpie"]);
  });
});
