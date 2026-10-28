# Walkthrough: promise vs proof, and the evals

What each rule does, why it exists, and which fixture or test shows it.

## Promise vs proof (`packages/core/src/proof.ts`)

**Job:** for each promise the listing makes ("no smears", "leak-proof"),
check it against what this product's own buyers say, and give a rate with an
honest interval. The model only reads a review and picks a label. Every
number is computed in code.

**The pipeline:** claims (code) → reviews about each claim (keywords, code) →
seeded sample (code) → labels (model, batched) → verify labels (code) →
counts, Wilson intervals, verdict (code).

### Rules

| Rule | Why | Proof |
|---|---|---|
| A claim is a claim-kind question whose verified grade is answered or partial, plus image claims the coverage step linked to it | Only verified quotes are used, so the claim text is the listing's real words. Spec questions (tip size) aren't promises reviews can test; experience questions have no promise. | `listingClaims` test; Pentel 2023's smudge claim is bullet.2 "no smears, no smudges, no globs" |
| Reviews are found by hand-written keywords per claim, matched at the start of a word | A few words decide recall: buyers say "smear" as often as "smudge", "lefty" as often as "left-handed". Matching at a word start means "smudg" finds smudges and smudging but "skip" doesn't match "skeptical". | `mentions` tests |
| Words common to the whole category are left out ("erase" on a dry-erase board) | Otherwise the filter keeps every review and does nothing. | `CLAIM_KEYWORDS` comment |
| A new category's claim falls back to the words of its id, not its question | Questions carry the category's common words ("ink", "pen"), which match everything. | `claimKeywords` test (`leak_proof` → leak, proof) |
| Under 30 matching reviews: "not enough evidence", no model call | An interval over a handful of reviews is too wide to mean anything, and it costs nothing to say so. | Amazon Basics board B0B42X682C has 5 reviews: 3 claims, 0 requests |
| A seeded random sample of up to 150, ordered by a hash of claim + review | Same answer every run (so recordings replay), unbiased within the matches, and each claim gets its own draw. 150 keeps a claim to 1-2 requests. | `sampleForClaim` test |
| Batches of up to 100, split evenly (150 → 75 + 75) | One claim and its evidence per prompt, so the model never judges a claim without its reviews in view; even batches so no call gets a thin slice. | fake-model test checks two batches of 75 |
| Labels are verified: index inside the batch, label one of the four, first label per review wins; skipped reviews stay unlabelled | Same principle as the grade verifier. A garbled or lazy answer shrinks the evidence; it can never invent any. | `verifyLabels` tests with out-of-range, non-integer, duplicate, unknown-label and non-list output |
| Review text is cleaned (`<br />`, `&#34;`) before the prompt | Raw dataset text is full of HTML. | prompt test |
| Rates are shares of reviews that discuss the claim (supports + contradicts + mixed) | A "dries out" review found by a dry-time search isn't evidence either way. If fewer than 30 remain after removing unrelated ones, it's "not enough evidence" too. | `summarize` test with 40 unrelated of 62 |
| Wilson 95% interval | The textbook p ± 1.96·√(p(1-p)/n) goes below zero at small rates (2 of 60). Wilson stays in 0..1 and stays honest. | `wilson` tests: 4/40 → 4.0%-23.1% |
| Contested when the contradiction rate's lower bound is at least 5% | Some complaints are normal for any product (a bad unit, the wrong paper). A lower bound of 5% means, with 95% confidence, at least 1 in 20 reviewers who talk about it say the opposite: more than noise. It's a judgment call, kept as one named constant. | 12/100 is contested; 5/100 isn't (lower bound 2.2%) |
| "Mixed" is reported but doesn't contest | "Smudges on glossy paper" is a nuance for the brief, not proof the claim is false. | Pentel smudge: 7 mixed, still backed |
| Examples are the three most helpful reviews per label, cut around the first keyword | Reviews others found useful are the ones worth showing, and long reviews often get to the point late. Display only; the model always sees the whole review. | `exampleText` test |
| Live SerpApi listings never get reviews | The saved reviews are from 2023; a 2026 page isn't the same snapshot. The audit notes "Live listings come without review text". | pipeline test on serpapi B097CF46RC |

### What it found (dataset fixtures, 400 saved reviews each)

- **Pentel EnerGel B097CF46RC:** "no smears, no smudges" is backed: of 117
  reviews that mention smudging, 104 support, 6 contradict, 7 mixed
  (contradicted by 5%, interval 2-11%). The Phase 0 spike (4 clear + 3 mixed
  of 40) said the same. Left-handed, quick dry and ink flow are backed too.
  But "no globs" (leaking) is **contested**: 33 of 62 reviews that talk about
  leaking say the pens leak (53%, 41-65%), and durability ("Limited Lifetime
  Warranty") is contested at 61%: barrels crack at the thread.
- **Pilot G2 2023:** "smear-proof" contested (15%, 10-23%, plus 28 mixed:
  "smears if you don't give it a few seconds"), "Longest Lasting" contested
  at 19%.
- **Sharpie S-Gel 2023:** "no smear" backed, but only just (11 of 134
  contradict, 8%; the lower bound sits just under the 5% line), "no bleed"
  contested at 23%.
- **Scribbledo boards:** all four claims backed.

**Be upfront about selection bias.** Reviews that mention leaking are mostly
from people whose pens leaked; happy buyers rarely write "it doesn't leak".
So a rate is "of reviews that discuss it", never "of buyers", and the CLI and
UI must say so. That's why "contested" lands often on failure-shaped topics
(leaking, durability, sturdiness) and rarely on praise-shaped ones (dry
time). The verdict means "a real share of reviewers dispute this", which is
what a brand needs to know before Alexa repeats the claim.

**The fixture subset.** Each product keeps up to 400 reviews (300 biased to
its claims' keywords, round-robin across claims, plus a random 100), so
"N mention it" counts the saved subset. Production would run on all reviews.

**A prompt fix found on real data.** The first prompt labelled "the pen
broke within a month" as *supporting* "backed by a Limited Lifetime Warranty":
it read the warranty as the claim instead of durability. The second version
(`proof-labels@2026-10-28.2`) states the topic, and says to read indirect
words (a warranty, "smooth writing") as a promise on that topic. Pentel
durability went from nonsense to 36 contradicts of 60.

**Not done: the reverse direction** (strengths buyers praise that the listing
never claims). It needs a pass over all reviews per product, not one per
claim, so it would cost more calls than the rest of the check. Skipped for
now, as PLAN.md's cut order allows.

## Evals (`evals/`)

**Gold sets.** `gold/grades.jsonl`: 134 (listing, question) pairs over the 10
gel-pen fixtures and 5 dry-erase boards, each with the expected status, the
fields that state the answer, and a one-line reason. Labels were drafted from
the fields and rubrics, not from the model's grades. `gold/proof.jsonl`: the
40 hand-labelled Pentel spike pairs plus 20 drafted Sharpie bleed-through
pairs, including hard "unrelated" ones ("bleeds onto my clothes" is leaking).
See `REVIEW.md`: until reviewed, results are provisional.

**Runner** (`bun evals`): replays recorded answers only. A missing recording
is an error that prints the command to record it. It reports:

| Metric | Why |
|---|---|
| Accuracy after the verifier and of the model alone | The user sees the verified grade; the model alone shows what the verifier is worth. |
| Precision, recall, F1 per status and a confusion matrix | One accuracy number hides that "partial" is the weak status. |
| Verifier effect: changed toward gold, away, sideways | The verifier should only ever make things safer; this measures it. |
| Evidence precision and hit rate | A right status cited from the wrong field (the hero's clip bullet) is still a wrong answer. |
| Proof label accuracy, and on clear cases only | Comparable with the spike's 37/37 clear cases. |
| Cost per audit by step, at paid Flash-Lite prices | The README's "what would this cost" number, from recorded usage. |

`--check` fails when accuracy drops more than 2 points below
`baseline.json`; `evals/evals.test.ts` runs the same check in `bun test`.
The baseline is only written on first run or `--update-baseline`, so a
regression can't quietly become the new normal.

### First results (provisional)

- Grades: **85.1%** after the verifier (model alone 85.8%), 134 pairs.
  Answered F1 0.92, missing 0.87, contradicted 0.80, partial 0.71 (recall
  0.58: the model tends to call "only says no smear" missing for dry time,
  and "smooth writing" answered for ink flow).
- The verifier changed 1 of 134 statuses, and that one moved away from gold:
  Uni-ball B0143LMAEK is a white-ink pen, so "does it show on dark paper?"
  applies, but the conditional rule turned the model's correct "missing"
  into not_applicable. That's the cost of the conditional rule: it can't tell
  "doesn't apply" from "applies but isn't said". Worth a rubric fix.
- Known misgrades the verifier can't catch, now measured: hero
  surface_compatibility answered from the clip bullet; G2 2023 "erasable"
  answered from a bullet about Pilot's other pens; U Brands "contradicted"
  on two fields that agree it has a frame.
- Evidence: 97% of cited fields carry the answer.
- Proof labels: **86.7%** on 4 labels, 92.2% on clear cases. The main miss is
  "unrelated": the model reads "bleeds onto my clothes" as contradicting "no
  bleed" (3 of 4 unrelated pairs).
- Cost: about 10.6 requests, 32k input and 8.5k output tokens per full audit
  including competitors, images and proof: about $0.03 at paid Flash-Lite
  prices, $0 on the free tier.
