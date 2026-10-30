#!/usr/bin/env bun
/**
 * bun evals [--check] [--update-baseline] [--record]
 *
 * Replays recorded model answers against the gold labels and writes evals/results.md.
 * - baseline.json is written the first time, or with --update-baseline. It's never overwritten
 *   silently, so a regression can't become the new normal by accident.
 * - --check exits 1 when grade or proof accuracy is more than 2 points below the baseline (for CI).
 * - --record calls Gemini for proof labels that aren't recorded yet (needs GEMINI_API_KEY). Grades
 *   are never recorded here: they come from the audit recordings (apps/cli/src/audit.ts --record).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CachedLlm, GeminiLlm, PATIENT_RETRY } from "@aloud/providers";
import {
  baselineOf,
  checkAgainst,
  dollars,
  FIXTURES,
  MissingRecordingError,
  PRICE_PER_M,
  pct,
  runEvals,
  STATUSES,
  type Baseline,
  type EvalResult,
  type LabelScore,
} from "./lib";

const args = process.argv.slice(2);
const record = args.includes("--record");
const gemini = record ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", retry: PATIENT_RETRY }) : null;
const llm = new CachedLlm(gemini, join(FIXTURES, "llm"), record ? "record" : "replay");
const baselinePath = join(import.meta.dir, "baseline.json");

let result: EvalResult;
try {
  result = await runEvals(llm);
} catch (err) {
  if (err instanceof MissingRecordingError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const stored = (await readFile(baselinePath, "utf8").then(JSON.parse, () => null)) as Baseline | null;
await writeFile(join(import.meta.dir, "results.md"), markdown(result, stored));
console.log(summary(result));

if (args.includes("--check")) {
  if (!stored) {
    console.error("No evals/baseline.json to check against. Run `bun evals --update-baseline` first.");
    process.exit(1);
  }
  const problems = checkAgainst(result, stored);
  if (problems.length) {
    console.error(`Eval check failed:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("Eval check passed.");
} else if (!stored || args.includes("--update-baseline")) {
  await writeFile(baselinePath, `${JSON.stringify(baselineOf(result), null, 2)}\n`);
  console.log("Wrote evals/baseline.json");
}

function summary(r: EvalResult): string {
  return [
    `grades: ${r.grades.rows.length} pairs, accuracy ${pct(r.grades.accuracy)} (model before verifier ${pct(r.grades.modelAccuracy)})`,
    `proof labels: ${r.proof.rows.length} pairs, accuracy ${pct(r.proof.accuracy)}, clear cases ${pct(r.proof.clearAccuracy)}`,
    "wrote evals/results.md",
  ].join("\n");
}

function scoreTable(scores: LabelScore[]): string {
  const f = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
  return ["| label | gold count | precision | recall | F1 |", "|---|---:|---:|---:|---:|", ...scores.map((s) => `| ${s.label} | ${s.support} | ${f(s.precision)} | ${f(s.recall)} | ${f(s.f1)} |`)].join("\n");
}

function confusionTable<L extends string>(labels: L[], matrix: Record<L, Record<L, number>>): string {
  return [`| gold \\ predicted | ${labels.join(" | ")} |`, `|---|${labels.map(() => "---:").join("|")}|`, ...labels.map((g) => `| **${g}** | ${labels.map((p) => matrix[g][p]).join(" | ")} |`)].join("\n");
}

function markdown(r: EvalResult, base: Baseline | null): string {
  const g = r.grades;
  const p = r.proof;
  const wrong = g.rows.filter((x) => x.verified !== x.status);
  const proofWrong = p.rows.filter((x) => x.pred !== x.label);

  const n = r.costs.length;
  const avg = (f: (c: (typeof r.costs)[number]) => number) => r.costs.reduce((s, c) => s + f(c), 0) / n;
  const steps = [...new Set(r.costs.flatMap((c) => Object.keys(c.byStep)))].sort();
  const stepRows = steps.map((s) => {
    const req = avg((c) => c.byStep[s]?.requests ?? 0);
    const inT = avg((c) => c.byStep[s]?.inputTokens ?? 0);
    const outT = avg((c) => c.byStep[s]?.outputTokens ?? 0);
    return `| ${s} | ${req.toFixed(1)} | ${Math.round(inT)} | ${Math.round(outT)} | $${dollars(inT, outT).toFixed(4)} |`;
  });
  const vIn = avg((c) => c.vision.inputTokens);
  const vOut = avg((c) => c.vision.outputTokens);
  const tIn = avg((c) => c.inputTokens) + vIn;
  const tOut = avg((c) => c.outputTokens) + vOut;
  const withProof = r.costs.filter((c) => c.byStep["proof-labels"]);

  const d = r.drafts;
  const unreviewedGrades = d.grades.draft + d.grades.checked;
  const unreviewedProof = d.proof.draft + d.proof.checked;
  const both = (u: { draft: number; checked: number }) =>
    !u.draft ? "drafted and independently re-checked" : !u.checked ? "drafted only" : `${u.checked} drafted and independently re-checked, ${u.draft} drafted only`;
  const provisional =
    unreviewedGrades + unreviewedProof > 0
      ? `> **Provisional.** ${unreviewedGrades} of ${g.rows.length} grade labels (${both(d.grades)}) and ${unreviewedProof} of
> ${p.rows.length} proof labels (${both(d.proof)}) are not yet reviewed by a person (see [REVIEW.md](REVIEW.md)).
> \`draft-checked\` means a second pass against the listing and rubric, not a human review. The 40 Pentel smudge pairs
> were hand-labelled in an earlier test. Treat these numbers as a first measurement, not a result, until review is done.\n\n`
      : "";

  return `# Eval results

${provisional}Generated by \`bun evals\` from recorded answers (no network). Model \`gemini-3.5-flash-lite\`, prompts
\`${baselineOf(r).gradePromptVersion}\` and \`${baselineOf(r).proofPromptVersion}\`.${base ? ` Baseline: grades ${pct(base.gradeAccuracy)}, proof ${pct(base.proofAccuracy)}.` : ""}

## Grading (${g.rows.length} listing × question pairs, gel pens and dry-erase boards)

| | accuracy |
|---|---:|
| After the verifier (what users see) | **${pct(g.accuracy)}** |
| Model alone, before the verifier | ${pct(g.modelAccuracy)} |

Per status, after the verifier:

${scoreTable(g.perStatus)}

Confusion matrix (rows gold, columns the verified grade):

${confusionTable(STATUSES, g.confusion.matrix)}

**Verifier effect.** It changed the model's status on ${g.verifier.changed} of ${g.rows.length} pairs:
${g.verifier.toward} toward gold, ${g.verifier.away} away from gold, ${g.verifier.sideways} wrong either way.

**Evidence.** On the ${g.evidence.pairs} pairs where both gold and the grade name fields, ${pct(g.evidence.precision)} of the
cited fields carry the answer, and ${pct(g.evidence.hitRate)} of grades cite at least one right field.

Disagreements with gold:

| listing | question | gold | verified | model | flags |
|---|---|---|---|---|---|
${wrong.map((x) => `| ${x.source} ${x.asin} | ${x.intentId} | ${x.status} | ${x.verified} | ${x.modelStatus} | ${x.flags.join(", ")} |`).join("\n")}

## Promise vs proof labels (${p.rows.length} claim × review pairs)

| | accuracy |
|---|---:|
| All four labels | **${pct(p.accuracy)}** |
| Clear cases (gold supports or contradicts) | ${pct(p.clearAccuracy)} |
| Reviews the model left unlabelled | ${p.unlabelled} |

${scoreTable(p.perLabel)}

${confusionTable([...p.confusion.labels], p.confusion.matrix)}

Disagreements:

| pair | gold | model | review |
|---|---|---|---|
${proofWrong.map((x) => `| ${x.id} | ${x.label} | ${x.pred ?? "none"} | ${`${x.review.title} ${x.review.text}`.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, 140)} |`).join("\n")}

## Cost per audit (recorded usage, ${n} fixture audits)

Averages per audit, including grading up to 4 competitors (a first audit pays for them; later audits
reuse their cached grades). Priced at paid Gemini Flash-Lite rates ($${PRICE_PER_M.input} / 1M input,
$${PRICE_PER_M.output} / 1M output, checked ${PRICE_PER_M.checked}). On the free tier it's $0.

| step | requests | input tokens | output tokens | paid cost |
|---|---:|---:|---:|---:|
${stepRows.join("\n")}
| transcribe (vision, saved) | ${(r.costs.filter((c) => c.vision.inputTokens > 0).length / n).toFixed(1)} | ${Math.round(vIn)} | ${Math.round(vOut)} | $${dollars(vIn, vOut).toFixed(4)} |
| **total** | ${(avg((c) => c.requests) + r.costs.filter((c) => c.vision.inputTokens > 0).length / n).toFixed(1)} | ${Math.round(tIn)} | ${Math.round(tOut)} | **$${dollars(tIn, tOut).toFixed(4)}** |

Promise vs proof ran on ${withProof.length} audits (dataset listings with saved reviews), averaging
${(withProof.reduce((s, c) => s + c.byStep["proof-labels"]!.requests, 0) / Math.max(1, withProof.length)).toFixed(1)} requests each.
`;
}
