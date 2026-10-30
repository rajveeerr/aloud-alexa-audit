import { describe, expect, test } from "bun:test";
import { pointsIfAnswered, scoreBand, scoreGrades } from "./score";
import type { Grade, GradeStatus, Intent } from "./types";

const intent = (id: string, frequency: number, kind: Intent["kind"] = "spec"): Intent => ({ id, kind, question: id, rubric: "", frequency });
const grade = (intentId: string, status: GradeStatus): Grade => ({ intentId, status, quotes: [], modelStatus: status, flags: [] });

describe("pointsIfAnswered", () => {
  const intents = [intent("ink", 60), intent("size", 20), intent("grip", 20), intent("feel", 500, "experience"), intent("scent", 40)];
  const grades = [grade("ink", "missing"), grade("size", "partial"), grade("grip", "answered"), grade("feel", "missing"), grade("scent", "not_applicable")];

  test("each counted question gains its share of the missing points", () => {
    expect(scoreGrades(grades, intents).score).toBe(30);
    const gains = pointsIfAnswered(grades, intents);
    expect(gains.get("ink")).toBe(60);
    expect(gains.get("size")).toBe(10);
    expect(gains.get("grip")).toBe(0);
  });

  test("experience and not-applicable questions gain nothing because they never count", () => {
    const gains = pointsIfAnswered(grades, intents);
    expect(gains.has("feel")).toBe(false);
    expect(gains.has("scent")).toBe(false);
  });

  test("the gain matches rescoring with that one grade answered", () => {
    const odd = [intent("a", 7), intent("b", 3), intent("c", 11)];
    const g = [grade("a", "missing"), grade("b", "partial"), grade("c", "contradicted")];
    const before = scoreGrades(g, odd).score!;
    for (const [id, gain] of pointsIfAnswered(g, odd)) {
      const after = scoreGrades(g.map((x) => (x.intentId === id ? grade(id, "answered") : x)), odd).score!;
      expect(gain).toBe(after - before);
    }
  });

  test("nothing counted means no gains", () => {
    expect(pointsIfAnswered([grade("feel", "missing")], intents).size).toBe(0);
  });
});

describe("scoreBand", () => {
  test("cut-offs at 50 and 80", () => {
    expect(scoreBand(null)).toBeNull();
    expect(scoreBand(49)).toBe("not_ready");
    expect(scoreBand(50)).toBe("partly_ready");
    expect(scoreBand(79)).toBe("partly_ready");
    expect(scoreBand(80)).toBe("ready");
  });
});
