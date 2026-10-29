import { describe, expect, test } from "bun:test";
import { discussing, tooFew } from "./proof";

const counts = (supports: number, contradicts: number, mixed: number) => ({ supports, contradicts, mixed });

describe("tooFew", () => {
  test("many reviews use the words but few discuss the claim: shows the count that discusses it", () => {
    expect(tooFew({ matching: 480, sampled: 150, counts: counts(8, 3, 1) })).toBe(
      "480 reviews mention the words, but only 12 (of 150 sampled) discuss the claim, too few to judge.",
    );
    expect(tooFew({ matching: 40, sampled: 40, counts: counts(1, 0, 0) })).toBe("40 reviews mention the words, but only 1 discusses the claim, too few to judge.");
  });

  test("few reviews mention it at all", () => {
    expect(tooFew({ matching: 12, sampled: 12, counts: counts(9, 2, 1) })).toBe("Only 12 reviews mention the words, too few to judge.");
    expect(tooFew({ matching: 1, sampled: 1, counts: counts(1, 0, 0) })).toBe("Only 1 review mentions the words, too few to judge.");
  });

  test("discussing counts supports, contradicts and mixed, not unrelated", () => {
    expect(discussing({ counts: counts(104, 6, 7) })).toBe(117);
  });
});
