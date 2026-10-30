# Reviewing the gold labels

**Fastest way: `bun evals:review`**, then open http://127.0.0.1:5199. It shows each listing's
fields (with their ids) next to the question, its rubric, the drafted label and what the tool
said. Press `1`-`5` (grades) or `1`-`4` (proof) to set a label, `Enter` to accept the draft,
`←` / `→` to move. Click fields on the left to change the label's fields. Every decision is
written straight back to `gold/*.jsonl` (only that line changes, and `labeledBy` becomes
`"rajveer"`), so you can stop at any time. "Done: re-run evals" runs `bun evals` for you; the
steps under "After reviewing" still apply. The rules below are the same either way.

Every number in `results.md` is only as good as the labels it's scored
against. Most labels here are drafts. Until a person has reviewed them, the
results are provisional and shouldn't be quoted as accuracy.

`labeledBy` says who set each label:

- `"draft"`: drafted from the fields and rubric, not checked.
- `"draft-checked"`: drafted, then independently re-checked in a second pass against the
  listing fields and rubric (without looking at the tool's grades). Where the second pass
  disagreed, the label was changed and the reason starts with the old value, e.g. "was
  missing; ...". This is **not** a human review: these rows still need one.
- `"rajveer"`: reviewed by hand, here or in the review page.
- `"rajveer-spike"`: labelled by hand in an earlier test of the claim check.

Now:

- `gold/grades.jsonl`: 134 (listing, question) pairs, all `"draft-checked"`.
- `gold/proof.jsonl`: 60 (claim, review) pairs. 40 Pentel smudge pairs are
  `"rajveer-spike"`; 20 Sharpie bleed-through pairs are `"draft-checked"`.

The second pass changed two labels: the hero's (serpapi B0C9W8DD9S)
surface_compatibility from missing to partial, and `sharpie-bleed-12` from contradicts
to mixed. Start with those.

## Grades: for each line in `gold/grades.jsonl`

1. Print the listing's fields: `bun apps/cli/src/audit.ts <asin> --source <source>`
   shows the grades; for the raw fields, the field ids in the gold row
   (`bullet.2`, `attr.line_size`) are the ones `normalize` produces.
2. Find the question's rubric in `fixtures/intents/<category>.json`.
3. Decide the status from the fields and the rubric only, not from what the
   model said and not from what you know about the product:
   - `answered` / `partial`: what the rubric says counts.
   - `contradicted`: two fields give different answers to the same question.
   - `not_applicable`: only for questions marked conditional that don't apply
     to this product.
4. Check `fields`: every field that states the answer (both sides for a
   contradiction). Empty for missing and not_applicable.
5. Fix `status`, `fields` or `reason` if needed, then set `labeledBy` to
   `"rajveer"`.

Look hardest at the rows whose reason says "borderline", "debatable" or
"review": Pentel's "standard writing paper" (surface_compatibility, partial),
Scentco's pack count (2 packs of 8 vs Pack of 1, contradicted), BIC's
"assorted colors" (partial), VIZ-PRO durability (answered), and the hero's
surface_compatibility (now partial; bullet 4 lists uses like scrapbooking and gift
cards, the same level as the G2 listings' "notes, journaling", though some would say
missing, and "gift cards" could even be read as cardstock).

## Proof labels: for each line in `gold/proof.jsonl`

1. Read the claim (`claim`, the listing's own words) and the topic question
   for `intentId`.
2. Read the whole review and pick one label: `supports`, `contradicts`,
   `mixed` (true only in some conditions or for some units) or `unrelated`
   (doesn't talk about the topic; "bleeds onto my clothes" is leaking, not
   bleed-through).
3. Set `labeledBy` to `"rajveer"`.

Two spike labels may deserve a second look: `pentel-smudge-24` ("do not smear
on most papers") and `pentel-smudge-35` ("you don't have a lot of smearing")
are labelled supports, and the model calls both mixed.

## After reviewing

The stored baseline was measured against the drafts, so re-baseline once every label is reviewed:

```sh
bun evals --update-baseline   # rescore and store the new baseline
bun test                      # the eval test checks accuracy against it
```

Then remove the "Provisional" note from `results.md` by regenerating it
(`bun evals`) once no row says `"draft"` or `"draft-checked"`; the note is printed from
the count of both, and the review page counts both as still needing review.
