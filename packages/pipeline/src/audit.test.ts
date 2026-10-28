import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CachedLlm } from "@answerable/providers";
import { AuditError, runAudit } from "./audit";
import { fsStores } from "./stores";

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

  test("an unknown ASIN without live access is a clear error", async () => {
    await expect(runAudit({ asin: "B000000000", source: "serpapi" }, deps)).rejects.toBeInstanceOf(AuditError);
  });

  test("a paste without a title is a bad request", async () => {
    await expect(runAudit({ asin: "B0PASTE001", source: "paste" }, deps)).rejects.toMatchObject({ code: "bad_request" });
  });
});
