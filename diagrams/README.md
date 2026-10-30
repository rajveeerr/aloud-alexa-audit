# Architecture diagrams

Excalidraw files, in the order I present them. Open one at excalidraw.com
(menu > Open, or drag the file in), then press Shift+1 to fit it to the screen.
Each has an SVG export next to it for reading on GitHub.

| # | File | What it shows |
|---|---|---|
| 1 | [01-salesduo-fit](01-salesduo-fit.svg) | The four SalesDuo surfaces the audit plugs into, and the endpoint each one calls. |
| 2 | [02-system](02-system.svg) | Browser and widget, Express API, MySQL, Redis/BullMQ, worker, runAudit, Gemini, SerpApi, the response cache and fixtures. |
| 3 | [03a-audit-pipeline](03a-audit-pipeline.svg) | runAudit steps 1-10 in code order: fetch to hidden answers, model steps vs code steps. |
| 4 | [03b-audit-pipeline](03b-audit-pipeline.svg) | Steps 11-15: promise vs proof, competitors, gaps, briefs, faithfulness, and the calls and cost per audit. |
| 5 | [04a-trust-layer](04a-trust-layer.svg) | Each model output for grades and images, and the code check that follows it. |
| 6 | [04b-trust-layer](04b-trust-layer.svg) | The same for briefs, the judge, contradictions and review labels, with the "and leaking" example. |
| 7 | [05-any-category](05-any-category.svg) | How an audit finds its question set, estimates one when there is none, and how sets are mined offline from reviews. |
| 8 | [06-job-lifecycle](06-job-lifecycle.svg) | The states of an audit row and every way it moves between them. |
| 9 | [07-evals-and-cost](07-evals-and-cost.svg) | The gold set, the eval runner, the CI check and the headline numbers. |

## Talk track

**1. SalesDuo fit.** SalesDuo's own blog says Alexa visibility isn't available
as a metric in Seller Central. I can't measure Alexa, but I can measure what it
reads. Aloud sits in the middle: its gaps become briefs for Creative
Studio, its score goes to the BI dashboard over time, Cohesity can ask for a
rescore when a listing changes, and the homepage widget turns a free audit into
a lead.

**2. System.** It's built on SalesDuo's stack. The React app and the widget
call an Express API that validates every input with zod and checks API keys and
rate limits. The API saves the audit row in MySQL and queues a job in Redis; the
worker runs it at the pace Gemini's free tier allows. Every model call goes
through a cache, and the recorded answers live in fixtures, so tests and CI run
with no network and no keys.

**3. Audit pipeline, part 1.** This is runAudit in the order the code runs it.
Green steps are plain code, orange steps are model calls. The model grades
every question in one call, and the verifier checks it straight after. Then one
vision call reads the images, and a hidden answer needs the text grade and an
image claim to agree. On the hero listing that finds "Smooth Writing without
Skipping", which sits only in images while 171 of 600 sampled reviewers ask
about skipping.

**4. Audit pipeline, part 2.** Then it checks the listing's claims against its
own reviews, grades up to four competitors, ranks the gaps in code, and drafts
fixes with a second call checking them. A full audit averages about 10.6 model
requests, which is about 3 cents on paid Flash-Lite and nothing on the free
tier. An unchanged listing costs nothing again, because every call is cached.

**5. Trust layer, part 1.** Nothing the model says reaches the user without
passing code. A quote has to be in the field it cites, an answer with no
surviving quote becomes missing, a contradiction needs quotes from two fields,
and "not applicable" is only allowed for questions that really are optional.

**6. Trust layer, part 2.** The fixes go through the same kind of checks.
Every number in a draft has to come from the brand's own data, a contradiction
is never guessed, the brand is asked instead, and review labels are checked
before any rate is computed. Here's a real case: the image says the wax seal
prevents drying, the draft added "and leaking", and the judge held it back.

**7. Any category.** The questions are data, not code. The audit walks the
listing's category path from the deepest level up and uses the first question
set that matches. If none does, it estimates a set right away from the listing
and its competitors, gives every question equal weight, and says so in the
report. Where reviews exist, I mine a proper set once per category, offline:
the model finds needs and groups them, and code does all the counting.

**8. Job lifecycle.** Every audit ends in done or failed, never stuck. A used-up
daily quota waits for the reset instead of burning retries. Transient errors
retry three times with backoff, and bad input fails at once. A crashed worker
or a queue that's down still ends with the row marked failed. Rescore skips a
listing whose content hash hasn't changed.

**9. Evals and cost.** I keep a gold set of 134 grading pairs and 60 review
labels. `bun evals` replays the recorded answers offline, and CI fails if
accuracy drops more than two points or the set or prompt changed. Grading is at
85.1% and proof labels at 92.0% on clear cases. The labels were drafted and
re-checked, but I haven't reviewed them yet, so these are a first measurement.

## Editing

`bun run diagrams` rebuilds every `.excalidraw` file from `build.ts` (shapes
and helpers in `lib.ts`). The numbers in it come from `evals/results.md` and
the recorded fixture audits; update both together. Small layout tweaks can be
made by hand in excalidraw.com too (a rebuild overwrites them): text is bound to its box and arrows are
bound to the shapes they connect, so things move together. After a change,
export the SVG from excalidraw.com (menu > Export image > SVG) and replace the
file here.
