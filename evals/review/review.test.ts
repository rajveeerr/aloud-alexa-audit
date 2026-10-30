import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GoldGrade, GoldProof } from "../lib";
import { applyGradeDecision, applyProofDecision, atomicWrite, gradeKey, parseJsonl, replaceRow, serializeJsonl, updateRow } from "./jsonl";

const grade = (over: Partial<GoldGrade> = {}): GoldGrade => ({
  source: "dataset",
  asin: "B000000001",
  intentId: "tip_size",
  status: "partial",
  fields: ["title"],
  labeledBy: "draft",
  reason: "Only says fine.",
  ...over,
});

const proof: GoldProof = {
  id: "p-1",
  asin: "B000000001",
  intentId: "smudge",
  claim: "no smears",
  review: { title: "", text: "It smears a bit on glossy paper." },
  rating: 3,
  label: "contradicts",
  labeledBy: "draft",
  reason: "draft",
};

async function tmp() {
  return mkdtemp(join(tmpdir(), "gold-review-"));
}

describe("jsonl", () => {
  // Odd spacing and escapes on the lines that don't change, so a re-serialise would show.
  const text = `{"a": 1}\n{"source":"dataset","asin":"B1","intentId":"x","status":"missing","fields":[],"labeledBy":"draft","reason":"caf\\u00e9"}\n{ "b":2 }\n`;

  test("parses rows and remembers their lines", () => {
    const doc = parseJsonl(text);
    expect(doc.rows).toHaveLength(3);
    expect(doc.lineOf).toEqual([0, 1, 2]);
    expect(serializeJsonl(doc)).toBe(text);
  });

  test("replacing a row rewrites only that line", () => {
    const doc = parseJsonl<Record<string, unknown>>(text);
    const out = serializeJsonl(replaceRow(doc, 2, { b: 3 })).split("\n");
    const before = text.split("\n");
    expect(out[0]).toBe(before[0]!);
    expect(out[1]).toBe(before[1]!);
    expect(out[2]).toBe(`{"b":3}`);
    expect(out[3]).toBe("");
  });

  test("skips blank lines and keeps CRLF and a missing final newline", () => {
    const doc = parseJsonl<Record<string, number>>(`{"a":1}\r\n\n{"a":2}`);
    expect(doc.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(serializeJsonl(replaceRow(doc, 0, { a: 9 }))).toBe(`{"a":9}\r\n\n{"a":2}`);
    expect(serializeJsonl(replaceRow(doc, 1, { a: 9 }))).toBe(`{"a":1}\r\n\n{"a":9}`);
  });

  test("an unknown row index throws", () => {
    expect(() => replaceRow(parseJsonl(text), 5, {})).toThrow();
  });
});

describe("decisions", () => {
  test("accepting a draft only changes labeledBy, and keeps the key order", () => {
    const g = grade();
    const out = applyGradeDecision(g, { status: g.status, fields: g.fields, reason: g.reason });
    expect(out).toEqual({ ...g, labeledBy: "rajveer" });
    expect(Object.keys(out)).toEqual(Object.keys(g));
    expect(JSON.stringify(out)).toBe(JSON.stringify(g).replace(`"labeledBy":"draft"`, `"labeledBy":"rajveer"`));
  });

  test("accepting a re-checked draft marks it reviewed by rajveer", () => {
    const g = grade({ labeledBy: "draft-checked" });
    expect(applyGradeDecision(g, { status: g.status, fields: g.fields })).toEqual({ ...g, labeledBy: "rajveer" });
  });

  test("a new status, fields and note", () => {
    const out = applyGradeDecision(grade(), { status: "answered", fields: ["bullet.2", "title", "bullet.2"], reason: "  0.5 mm in bullet 2. " });
    expect(out).toMatchObject({ status: "answered", fields: ["bullet.2", "title"], reason: "0.5 mm in bullet 2.", labeledBy: "rajveer" });
  });

  test("an empty note keeps the reason", () => {
    expect(applyGradeDecision(grade(), { status: "partial", fields: ["title"], reason: "  " }).reason).toBe("Only says fine.");
  });

  test("missing and not applicable save with no fields", () => {
    expect(applyGradeDecision(grade(), { status: "missing", fields: ["title"] }).fields).toEqual([]);
    expect(applyGradeDecision(grade(), { status: "not_applicable", fields: ["title"] }).fields).toEqual([]);
  });

  test("rejects an unknown status or label", () => {
    expect(() => applyGradeDecision(grade(), { status: "yes" as never, fields: [] })).toThrow();
    expect(() => applyProofDecision(proof, { label: "maybe" as never })).toThrow();
  });

  test("proof decision", () => {
    const out = applyProofDecision(proof, { label: "mixed" });
    expect(out).toEqual({ ...proof, label: "mixed", labeledBy: "rajveer" });
    expect(Object.keys(out)).toEqual(Object.keys(proof));
  });
});

describe("writing", () => {
  test("atomic write replaces the file and leaves no temp file", async () => {
    const dir = await tmp();
    try {
      const path = join(dir, "grades.jsonl");
      await writeFile(path, "old\n");
      await atomicWrite(path, "new\n");
      expect(await readFile(path, "utf8")).toBe("new\n");
      expect(await readdir(dir)).toEqual(["grades.jsonl"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("a failed write leaves the original file alone", async () => {
    const dir = await tmp();
    try {
      const path = join(dir, "grades.jsonl");
      await writeFile(path, "old\n");
      // Renaming a file over a non-empty directory fails, after the temp file is written.
      const blocked = join(dir, "blocked");
      await Bun.write(join(blocked, "x"), "x");
      await expect(atomicWrite(blocked, "new\n")).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe("old\n");
      expect((await readdir(dir)).sort()).toEqual(["blocked", "grades.jsonl"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("updateRow changes exactly one line on disk", async () => {
    const dir = await tmp();
    try {
      const path = join(dir, "grades.jsonl");
      const rows = [grade(), grade({ intentId: "smudge", status: "answered", fields: ["bullet.2"] }), grade({ intentId: "dry_time" })];
      const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await writeFile(path, text);
      await updateRow<GoldGrade>(path, 1, gradeKey(rows[1]!), gradeKey, (r) => applyGradeDecision(r, { status: r.status, fields: r.fields }));
      const before = text.split("\n");
      const after = (await readFile(path, "utf8")).split("\n");
      expect(after).toHaveLength(before.length);
      expect(after.map((l, n) => (l === before[n] ? null : n)).filter((n) => n !== null)).toEqual([1]);
      expect(JSON.parse(after[1]!).labeledBy).toBe("rajveer");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("updateRow refuses when the row at that index isn't the expected one", async () => {
    const dir = await tmp();
    try {
      const path = join(dir, "grades.jsonl");
      const text = JSON.stringify(grade()) + "\n";
      await writeFile(path, text);
      await expect(updateRow<GoldGrade>(path, 0, "dataset:B000000001:smudge", gradeKey, (r) => r)).rejects.toThrow(/Reload/);
      expect(await readFile(path, "utf8")).toBe(text);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test("the real gold files round-trip unchanged", async () => {
  for (const f of ["grades.jsonl", "proof.jsonl"]) {
    const text = await readFile(join(import.meta.dir, "..", "gold", f), "utf8");
    const doc = parseJsonl<Record<string, unknown>>(text);
    // Re-serialising every row must give the same bytes, so a saved row matches the file's style.
    let out = doc;
    doc.rows.forEach((r, i) => (out = replaceRow(out, i, r)));
    expect(serializeJsonl(out)).toBe(text);
  }
});
