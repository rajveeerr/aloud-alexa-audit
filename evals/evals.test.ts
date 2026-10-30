import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GRADE_PROMPT_VERSION, PROOF_PROMPT_VERSION } from "@aloud/core";
import { CachedLlm } from "@aloud/providers";
import { accuracy, checkAgainst, confusion, FIXTURES, perLabel, readJsonl, runEvals, STATUSES, verifierEffect, type Baseline, type GoldGrade, type GoldProof } from "./lib";

describe("metrics", () => {
  test("confusion, precision, recall and F1", () => {
    const c = confusion(["a", "b"], [
      { gold: "a", pred: "a" },
      { gold: "a", pred: "b" },
      { gold: "b", pred: "b" },
      { gold: "b", pred: "b" },
    ]);
    expect(c.matrix).toEqual({ a: { a: 1, b: 1 }, b: { a: 0, b: 2 } });
    const [a, b] = perLabel(c);
    expect(a).toEqual({ label: "a", support: 2, precision: 1, recall: 0.5, f1: 2 / 3 });
    expect(b!.precision).toBeCloseTo(2 / 3, 6);
    expect(b!.recall).toBe(1);
  });

  test("precision is n/a when a label is never predicted", () => {
    const [, b] = perLabel(confusion(["a", "b"], [{ gold: "b", pred: "a" }]));
    expect(b).toEqual({ label: "b", support: 1, precision: null, recall: 0, f1: null });
  });

  test("accuracy", () => {
    expect(accuracy([{ gold: "x", pred: "x" }, { gold: "x", pred: "y" }])).toBe(0.5);
  });

  test("the verifier moving toward, away from, or around gold", () => {
    expect(
      verifierEffect([
        { gold: "missing", model: "answered", verified: "missing" },
        { gold: "missing", model: "missing", verified: "not_applicable" },
        { gold: "partial", model: "answered", verified: "missing" },
        { gold: "answered", model: "answered", verified: "answered" },
      ]),
    ).toEqual({ changed: 3, toward: 1, away: 1, sideways: 1 });
  });
});

describe("gold sets", () => {
  test("every gold row is well-formed", async () => {
    const grades = await readJsonl<GoldGrade>(join(import.meta.dir, "gold/grades.jsonl"));
    const proof = await readJsonl<GoldProof>(join(import.meta.dir, "gold/proof.jsonl"));
    expect(grades.length).toBeGreaterThanOrEqual(120);
    expect(proof).toHaveLength(60);
    for (const g of grades) {
      expect(STATUSES).toContain(g.status);
      expect(g.reason.length).toBeGreaterThan(0);
      // An answer needs a field that states it; no answer means no field.
      if (g.status === "missing" || g.status === "not_applicable") expect(g.fields).toEqual([]);
      else expect(g.fields.length).toBeGreaterThan(g.status === "contradicted" ? 1 : 0);
    }
    expect(new Set(grades.map((g) => `${g.source}:${g.asin}:${g.intentId}`)).size).toBe(grades.length);
    expect(proof.filter((p) => p.labeledBy === "rajveer-spike")).toHaveLength(40);
  });
});

describe("evals (replayed, no network)", () => {
  test("accuracy hasn't dropped more than 2 points below the stored baseline", async () => {
    const llm = new CachedLlm(null, join(FIXTURES, "llm"), "replay");
    const result = await runEvals(llm);
    const base = JSON.parse(await readFile(join(import.meta.dir, "baseline.json"), "utf8")) as Baseline;
    expect(checkAgainst(result, base)).toEqual([]);
    // The known hard cases from the first audits stay visible in the results.
    const row = (asin: string, intentId: string) => result.grades.rows.find((r) => r.asin === asin && r.intentId === intentId)!;
    expect(row("B0C9W8DD9S", "surface_compatibility")).toMatchObject({ status: "partial", verified: "answered" });
    expect(row("B0143LMAEK", "pack_contents")).toMatchObject({ status: "contradicted", verified: "contradicted" });
    expect(row("B097CF46RC", "tip_size").verified).toBe("contradicted");
  }, 30_000);

  const fakeRun = (gradeAccuracy: number, proofAccuracy: number, gradePairs = 2, proofPairs = 1) =>
    ({ grades: { accuracy: gradeAccuracy, rows: Array(gradePairs) }, proof: { accuracy: proofAccuracy, rows: Array(proofPairs) } }) as unknown as Parameters<typeof checkAgainst>[0];
  const base: Baseline = { gradeAccuracy: 0.9, proofAccuracy: 0.9, gradePairs: 2, proofPairs: 1, gradePromptVersion: GRADE_PROMPT_VERSION, proofPromptVersion: PROOF_PROMPT_VERSION };

  test("the check fails on a drop of more than 2 points, not on a smaller one", () => {
    expect(checkAgainst(fakeRun(0.87, 0.89), base)).toHaveLength(1);
    expect(checkAgainst(fakeRun(0.885, 0.89), base)).toEqual([]);
  });

  test("the check fails when the baseline was measured on another gold set or prompt", () => {
    const problems = checkAgainst(fakeRun(0.95, 0.95, 3, 2), { ...base, gradePromptVersion: "grade@old", proofPromptVersion: "proof-labels@old" });
    expect(problems).toHaveLength(4);
    expect(problems.every((p) => p.includes("--update-baseline"))).toBe(true);
    expect(problems[0]).toContain("2 grade pairs, this run has 3");
  });
});
