import { describe, expect, test } from "bun:test";
import { estimate, partialSpearman, ranks, spearman, spearmanStat } from "./stats";

describe("study stats", () => {
  test("ties share the average rank", () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  test("spearman is 1 for any increasing relation and -1 for a decreasing one", () => {
    const x = [1, 2, 3, 4, 5, 6];
    expect(spearman(x, x.map((v) => v ** 3))).toBeCloseTo(1);
    expect(spearman(x, x.map((v) => -Math.log(v)))).toBeCloseTo(-1);
  });

  test("partial spearman matches the textbook formula on ranks", () => {
    const x = [3, 1, 4, 1, 5, 9, 2, 6];
    const y = [2, 7, 1, 8, 2, 8, 1, 8];
    const z = [1, 4, 1, 4, 2, 1, 3, 5];
    const [xy, xz, yz] = [spearman(x, y), spearman(x, z), spearman(y, z)];
    expect(partialSpearman(x, y, z)).toBeCloseTo((xy - xz * yz) / Math.sqrt((1 - xz ** 2) * (1 - yz ** 2)));
  });

  test("partial spearman drops near zero when y is just the control plus noise x doesn't share", () => {
    const n = 200;
    const z = Array.from({ length: n }, (_, i) => i);
    const x = z.map((v, i) => v + ((i * 37) % 23) * 4);
    const y = z.map((v, i) => v + ((i * 53) % 29) * 4);
    expect(spearman(x, y)).toBeGreaterThan(0.8);
    expect(Math.abs(partialSpearman(x, y, z))).toBeLessThan(0.25);
  });

  test("estimate is repeatable and finds a clear relation", () => {
    const x = Array.from({ length: 40 }, (_, i) => i);
    const y = x.map((v) => v + (v % 5) * 3);
    const a = estimate(spearmanStat, [x, y], 7);
    expect(estimate(spearmanStat, [x, y], 7)).toEqual(a);
    expect(a.p).toBeLessThan(0.001);
    expect(a.ci[0]).toBeGreaterThan(0.8);
    expect(a.ci[1]).toBeLessThanOrEqual(1);
  });
});
