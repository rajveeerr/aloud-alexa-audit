# Evals

`bun evals` scores the grader and the review labeller against a gold set, replaying recorded model answers with no network. Results go to [results.md](results.md).

## What's measured

- **Grading statuses**: accuracy after the verifier and of the model alone, precision, recall and F1 per status, a confusion matrix, and whether the cited fields really carry the answer.
- **Verifier effect**: how many statuses the verifier changed, and whether each change moved toward gold or away from it.
- **Proof labels**: accuracy on all four labels and on clear cases (gold supports or contradicts).
- **Cost per audit**: requests and tokens per step from recorded usage, priced at paid Gemini Flash-Lite rates.

## Running it

```sh
bun evals                     # rescore and rewrite results.md
bun evals --check             # exit 1 if accuracy drops more than 2 points below baseline.json, or the set or prompt version changed (CI runs this)
bun evals --update-baseline   # store the current scores as the new baseline
bun evals:review              # label review page at http://127.0.0.1:5199
```

A missing recording is an error that prints the command to record it. The baseline is only written on the first run or with `--update-baseline`, so a regression can't become the new normal by accident. `evals.test.ts` runs the same check in `bun test`.

The review page shows each listing's fields next to the question, its rubric, the current label and what the tool said. Keys `1`-`5` (grades) or `1`-`4` (proof) set a label, `Enter` accepts it, arrows move. Each decision is written straight back to its line in `gold/*.jsonl` with `labeledBy: "rajveer"`.

## Gold set

- `gold/grades.jsonl`: 134 (listing, question) pairs over 10 gel-pen listings and 5 dry-erase boards. Each row has `status`, `fields` (every field that states the answer, both sides for a contradiction, empty for missing and not_applicable) and a one-line `reason`. Labels are decided from the fields and the rubric in `fixtures/intents/<category>.json`, not from the model's grades.
- `gold/proof.jsonl`: 60 (claim, review) pairs, each labelled `supports`, `contradicts`, `mixed` (true only in some conditions or for some units) or `unrelated` (doesn't discuss the topic; "bleeds onto my clothes" is leaking, not bleed-through).

## Label provenance

`labeledBy` records who set each label:

- `"draft"`: drafted from the fields and rubric, not checked.
- `"draft-checked"`: drafted, then re-checked in an independent second pass against the listing and rubric without looking at the tool's grades. Changed labels have a reason starting with the old value ("was missing; ..."). This is not a human review.
- `"rajveer-spike"`: labelled by hand in an earlier test of the claim check.
- `"rajveer"`: reviewed by a person, in the review page or by hand.

Right now all 134 grade labels are `draft-checked`. Of the 60 proof labels, 40 Pentel smudge pairs were labelled by hand (`rajveer-spike`) and 20 Sharpie bleed-through pairs are `draft-checked`. None of the grade labels and none of those 20 proof labels have been reviewed by a person yet, so every number in results.md is provisional until that review is done. results.md prints this note from the label counts and drops it once no row is `draft` or `draft-checked`.

## Rows to review first

- The two labels the second pass changed: the hero's (serpapi B0C9W8DD9S) surface_compatibility, missing to partial, and `sharpie-bleed-12`, contradicts to mixed.
- Borderline grade rows: Pentel's "standard writing paper" (surface_compatibility, partial), Scentco's pack count (2 packs of 8 vs Pack of 1, contradicted), BIC's "assorted colors" (partial), VIZ-PRO durability (answered), and the hero's surface_compatibility (bullet 4 lists uses like scrapbooking and gift cards; some would call that missing).
- Two spike labels: `pentel-smudge-24` ("do not smear on most papers") and `pentel-smudge-35` ("you don't have a lot of smearing") are labelled supports, and the model calls both mixed.

After the review, run `bun evals --update-baseline` and `bun test`, since the stored baseline was measured against the drafts.
