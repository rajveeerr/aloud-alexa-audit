/**
 * Reading and rewriting the gold JSONL files one row at a time. Only the row that changed is
 * re-serialised; every other line, the line order and the trailing newline stay byte-for-byte.
 */
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { GradeStatus, ProofLabel } from "@aloud/core";
import { PROOF_LABELS, STATUSES, type GoldGrade, type GoldProof } from "../lib";

/** The raw lines of a file, and which line each parsed row came from. */
export type JsonlDoc<T> = { lines: string[]; rows: T[]; lineOf: number[] };

export function parseJsonl<T>(text: string): JsonlDoc<T> {
  const lines = text.split("\n");
  const rows: T[] = [];
  const lineOf: number[] = [];
  lines.forEach((line, n) => {
    if (!line.trim()) return;
    rows.push(JSON.parse(line) as T);
    lineOf.push(n);
  });
  return { lines, rows, lineOf };
}

export function serializeJsonl<T>(doc: JsonlDoc<T>): string {
  return doc.lines.join("\n");
}

/** Swaps row `index` for `row`, touching only that line. Keeps a CRLF ending if the line had one. */
export function replaceRow<T>(doc: JsonlDoc<T>, index: number, row: T): JsonlDoc<T> {
  const n = doc.lineOf[index];
  if (n === undefined) throw new Error(`No row ${index} (the file has ${doc.rows.length}).`);
  const lines = [...doc.lines];
  const cr = lines[n]!.endsWith("\r") ? "\r" : "";
  lines[n] = JSON.stringify(row) + cr;
  const rows = [...doc.rows];
  rows[index] = row;
  return { lines, rows, lineOf: doc.lineOf };
}

/** Writes to a temp file next to the target, then renames it over, so a crash never leaves half a file. */
export async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tmp, text);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

// ---------- decisions ----------

export type GradeDecision = { status: GradeStatus; fields: string[]; reason?: string };
export type ProofDecision = { label: ProofLabel; reason?: string };

/** The reviewed row: new status and fields, the note as reason if one was given, labeledBy rajveer. */
export function applyGradeDecision(row: GoldGrade, d: GradeDecision): GoldGrade {
  if (!STATUSES.includes(d.status)) throw new Error(`Unknown status ${JSON.stringify(d.status)}.`);
  if (!Array.isArray(d.fields) || d.fields.some((f) => typeof f !== "string")) throw new Error("fields must be a list of field ids.");
  // Missing and not_applicable never cite fields (REVIEW.md, step 4).
  const fields = d.status === "missing" || d.status === "not_applicable" ? [] : [...new Set(d.fields)];
  const reason = d.reason?.trim() ? d.reason.trim() : row.reason;
  return { ...row, status: d.status, fields, labeledBy: "rajveer", reason };
}

export function applyProofDecision(row: GoldProof, d: ProofDecision): GoldProof {
  if (!PROOF_LABELS.includes(d.label)) throw new Error(`Unknown label ${JSON.stringify(d.label)}.`);
  const reason = d.reason?.trim() ? d.reason.trim() : row.reason;
  return { ...row, label: d.label, labeledBy: "rajveer", reason };
}

export const gradeKey = (g: Pick<GoldGrade, "source" | "asin" | "intentId">) => `${g.source}:${g.asin}:${g.intentId}`;

/**
 * Re-reads the file, checks row `index` is still the one the page showed (so an edit made by
 * hand in the meantime isn't overwritten by the wrong row), applies `update` and writes it back.
 */
export async function updateRow<T>(path: string, index: number, expectedKey: string, keyOf: (row: T) => string, update: (row: T) => T): Promise<T> {
  const doc = parseJsonl<T>(await readFile(path, "utf8"));
  const current = doc.rows[index];
  if (current === undefined) throw new Error(`No row ${index} in ${basename(path)}.`);
  if (keyOf(current) !== expectedKey) throw new Error(`Row ${index} of ${basename(path)} is ${keyOf(current)}, not ${expectedKey}. Reload the page.`);
  const next = update(current);
  await atomicWrite(path, serializeJsonl(replaceRow(doc, index, next)));
  return next;
}
