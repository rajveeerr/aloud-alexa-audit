/**
 * Builds the architecture diagrams as Excalidraw files: bun diagrams/build.ts
 * Open any diagrams/*.excalidraw in excalidraw.com (File > Open, or drag it in) to present or edit.
 * Numbers come from evals/results.md and the recorded fixture audits; keep them in step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { C, S, Scene } from "./lib";

const OUT = import.meta.dir;
const scenes: Scene[] = [];
const scene = (name: string) => {
  const s = new Scene(name);
  scenes.push(s);
  return s;
};

const legend = (d: Scene, y: number, x = 0) => {
  d.legend("leg.model", x, y, S.model, "model call (Gemini)");
  d.legend("leg.code", x + 330, y, S.code, "plain code: checks, counts, scores");
};

// 1. Where it plugs into SalesDuo --------------------------------------------------------------
{
  const d = scene("01-salesduo-fit");
  d.title("Where Aloud plugs into SalesDuo", "One audit engine, four SalesDuo surfaces, each through one API endpoint.");
  d.shape(
    "quote",
    330,
    115,
    1140,
    115,
    S.note,
    "“Alexa recommendation visibility is not currently available\nas a standalone metric in Seller Central.”\nSalesDuo blog, June 2026",
    { size: 24 },
  );
  d.card("core", 680, 445, 440, 230, S.hero, "Aloud", "Paste an ASIN. See what a shopping\nassistant can say from the listing,\nwith proof, and the fixes ranked.", { headFill: C.orange });

  d.card("studio", 0, 270, 540, 220, S.box, "AI Creative Studio", "Each gap becomes a brief Studio can take:\ngaps → briefs → Studio drafts → re-audit\n\nPOST /v1/audits/:id/briefs", { headFill: C.text });
  d.card("bi", 1260, 270, 540, 220, S.box, "BI dashboard", "AI shelf readiness score per ASIN,\ntracked over time.\n\nGET /v1/asins/:asin/history", { headFill: C.text });
  d.card("cohesity", 0, 630, 540, 220, S.box, "Cohesity", "Listing changed → rescore webhook.\nSkipped if the content hash is unchanged.\n\nPOST /v1/rescore", { headFill: C.text });
  d.card("funnel", 1260, 630, 540, 220, S.box, "Homepage lead funnel", "Widget: instant audit, top 3 gaps free,\nemail for the full report.\n\nPOST /v1/public/audits", { headFill: C.text });

  d.arrow("a.studio", { id: "core", side: "left", t: 0 }, { id: "studio", side: "right", t: 0.1 }, { label: "briefs", both: true });
  d.arrow("a.bi", { id: "core", side: "right", t: 0 }, { id: "bi", side: "left", t: 0.1 }, { label: "scores" });
  d.arrow("a.cohesity", { id: "cohesity", side: "right", t: -0.1 }, { id: "core", side: "left", t: 0.35 }, { label: "rescore" });
  d.arrow("a.funnel", { id: "funnel", side: "left", t: -0.1 }, { id: "core", side: "right", t: 0.35 }, { label: "widget" });
  d.text("footer", 900, 880, "It doesn't measure Alexa. It measures what Alexa reads: the listing, its images and its reviews.", 24, { align: "center", color: C.muted });
}

// 2. System -----------------------------------------------------------------------------------
{
  const d = scene("02-system");
  d.title("System", "Bun + TypeScript on SalesDuo's stack: React, Express, MySQL, Redis/BullMQ. Runs at $0.");
  const col = [0, 480, 960, 1440];
  const W = 360;

  d.shape("web", col[0]!, 130, W, 95, S.box, "Browser\nReact app · port 5180");
  d.shape("widget", col[0]!, 245, W, 95, S.box, "Homepage widget\nno key · limited per IP");
  d.card("api", col[1]!, 130, W, 210, S.box, "Express API · port 4100", "zod validation on every input\nAPI keys (x-api-key, SHA-256)\nrate limits kept in Redis\nOpenAPI at /v1/openapi.json", { headFill: C.text, size: 21 });
  d.card("redis", col[2]!, 130, W, 210, S.store, "Redis + BullMQ", "queue \"audits\"\njob id = audit id,\nenqueue twice = no-op", { headFill: C.text });
  d.card("worker", col[3]!, 130, W, 210, S.box, "Worker", "limiter set by GEMINI_RPM\n3 attempts, backoff\ndaily quota → wait for reset", { headFill: C.text });

  d.shape("free", col[0]!, 420, W, 180, S.note, "$0 to run\nGemini + SerpApi free tiers,\nMySQL + Redis in\ndocker compose");
  d.card("mysql", col[1]!, 420, W, 180, S.store, "MySQL 8", "audits · listing_snapshots\nbulk_jobs · leads · api_keys", { headFill: C.text });
  d.card("serpapi", col[2]!, 420, W, 180, S.store, "SerpApi", "listings + Amazon search,\nlive only when asked\n$0 tier: 250 searches/month", { headFill: C.text, size: 21 });
  d.card("pipeline", col[3]!, 420, W, 180, S.code, "runAudit (pipeline)", "one function shared by\nCLI, worker and tests\n→ packages/core (pure)", { headFill: C.green });

  d.card("fixtures", 0, 680, 760, 190, S.store, "fixtures/ (in the repo)", "saved listings, reviews, image claims and recorded\nmodel answers. Tests and CI replay them:\nno network, no keys.", { headFill: C.text });
  d.card("cache", col[2]!, 680, W, 190, S.code, "LLM response cache", "key: model + prompt version\n+ schema + inputs\nrecord: call once and save\nreplay: never calls", { headFill: C.green, size: 21 });
  d.card("gemini", col[3]!, 680, W, 190, S.model, "Gemini 3.5 Flash-Lite", "text + vision, JSON schema,\ntemperature 0\n$0 free tier (about 10 RPM)", { headFill: C.orange, size: 21 });

  d.arrow("a.web", { id: "web", side: "right" }, { id: "api", side: "left", t: -0.12 });
  d.arrow("a.widget", { id: "widget", side: "right" }, { id: "api", side: "left", t: 0.38 });
  d.arrow("a.enqueue", { id: "api", side: "right", t: 0.1 }, { id: "redis", side: "left", t: 0.1 }, { label: "enqueue" });
  d.arrow("a.jobs", { id: "redis", side: "right", t: 0.1 }, { id: "worker", side: "left", t: 0.1 }, { label: "jobs" });
  d.arrow("a.db", { id: "api", side: "bottom", t: -0.2 }, { id: "mysql", side: "top", t: -0.2 }, { both: true });
  d.arrow("a.run", { id: "worker", side: "bottom", t: 0.2 }, { id: "pipeline", side: "top", t: 0.2 });
  d.arrow("a.save", { id: "worker", side: "bottom", t: -0.3 }, { id: "mysql", side: "top", t: 0.3 }, {
    via: [
      [col[3]! + W * 0.2, 380],
      [col[1]! + W * 0.8, 380],
    ],
    label: "status + results",
  });
  d.arrow("a.fetch", { id: "pipeline", side: "left", t: 0.1 }, { id: "serpapi", side: "right", t: 0.1 }, { label: "fetch" });
  d.arrow("a.llm", { id: "pipeline", side: "bottom", t: -0.25 }, { id: "cache", side: "top", t: 0.25 }, { label: "model calls" });
  d.arrow("a.miss", { id: "cache", side: "right", t: 0.1 }, { id: "gemini", side: "left", t: 0.1 }, { label: "miss" });
  d.arrow("a.rec", { id: "cache", side: "left", t: 0.1 }, { id: "fixtures", side: "right", t: 0.1 }, { label: "saved in\nfixtures/llm", dashed: true });
  d.arrow("a.snap", { id: "serpapi", side: "bottom", t: -0.3 }, { id: "fixtures", side: "top", t: 0.35 }, { label: "snapshots", dashed: true });
}

// 3a. Audit pipeline, part 1: read and grade the listing ---------------------------------------
const W5 = 328;
const x5 = (i: number) => i * (W5 + 40);

{
  const d = scene("03a-audit-pipeline");
  d.title("Audit pipeline 1/2: read and grade", "runAudit, in the order the code runs it. The model reads and judges; code checks, counts and scores.");
  const H = 175;
  const steps: [string, keyof typeof S, string][] = [
    ["fetch", "code", "1 · Fetch listing\nsaved snapshot first,\nlive SerpApi if asked\n0 calls"],
    ["normalize", "code", "2 · Normalize\nfields with ids, images,\nmeta, content hash\n0 calls"],
    ["competitors", "code", "3 · Find competitors\nup to 4, same leaf\ncategory, other brands\n0 calls"],
    ["intents", "code", "4 · Pick question set\nby category path\n(none: estimate, 1 call)\n0 calls"],
    ["grade", "model", "5 · Grade all questions\nspec + claim questions,\nquotes with field ids\n1 call"],
    ["verify", "code", "6 · Verifier\nquotes checked in their\nfields; statuses fixed\n0 calls"],
    ["score", "code", "7 · Score\nfrequency-weighted,\nshown with counts\n0 calls"],
    ["images", "model", "8 · Read images\nprinted claims, verbatim,\nper [img.N]\n1 vision call"],
    ["coverage", "model", "9 · Coverage\nin text? code match first,\nthen the model\n1 call"],
    ["hidden", "code", "10 · Hidden answers\ntext grade missing/partial\nAND an image claim\n0 calls"],
  ];
  steps.forEach(([id, style, label], i) => d.shape(id, x5(i % 5), i < 5 ? 150 : 430, W5, H, S[style]!, label));
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i]![0];
    const b = steps[i + 1]![0];
    if (i === 4) {
      d.arrow(`a.${a}`, { id: a, side: "bottom" }, { id: b, side: "top" }, {
        via: [
          [x5(4) + W5 / 2, 380],
          [x5(0) + W5 / 2, 380],
        ],
      });
    } else d.arrow(`a.${a}`, { id: a, side: "right" }, { id: b, side: "left" });
  }
  legend(d, 640);
  d.shape(
    "sum",
    0,
    700,
    1800,
    110,
    S.note,
    "Hero listing (Ddaowanx): score 52 (answers 8 of 15), and 2 hidden answers. “Smooth Writing without Skipping”\nis only in its images, while 171 of 600 sampled reviewers ask about skipping. Pilot, BIC and Pentel: 0.",
    { size: 24 },
  );
}

// 3b. Audit pipeline, part 2: proof, competitors, fixes -----------------------------------------
{
  const d = scene("03b-audit-pipeline");
  d.title("Audit pipeline 2/2: proof and fixes", "Then the same function checks claims against reviews, compares competitors and drafts the fixes.");
  const steps: [string, keyof typeof S, string][] = [
    ["proof", "model", "11 · Promise vs proof\nsample ≤150 reviews per\nclaim, labels in batches,\nWilson interval in code\n~2 calls (with reviews)"],
    ["comp", "model", "12 · Grade competitors\nsame question set,\nsame verifier\n1 call each, up to 4"],
    ["gaps", "code", "13 · Gaps\nfrequency × gain ×\n(0.5 + 0.5 × share of\ncompetitors answering)\n0 calls"],
    ["briefs", "model", "14 · Briefs\ntop 8 gaps, brand's own\nfacts only; code checks\nsources and numbers\n1 call"],
    ["faith", "model", "15 · Faithfulness\na judge lists unsupported\nstatements; it can only\nremove claims\n0-1 call"],
  ];
  steps.forEach(([id, style, label], i) => d.shape(id, x5(i), 150, W5, 200, S[style]!, label));
  for (let i = 0; i < steps.length - 1; i++) d.arrow(`a.${steps[i]![0]}`, { id: steps[i]![0], side: "right" }, { id: steps[i + 1]![0], side: "left" });

  d.shape(
    "calls",
    0,
    400,
    1800,
    170,
    S.box,
    "Per audit (average of 25 recorded fixture audits)\ngrade 5.0 (listing + up to 4 competitors) · promise vs proof 2.0 · read images 1 · coverage 1 · briefs 1 · faithfulness 0.6\n= about 10.6 model requests, 32k input + 8.5k output tokens",
    { size: 24 },
  );
  d.shape("cost", 0, 610, 870, 110, S.model, "about $0.03 per audit on paid Flash-Lite\n$0 on the free tier", { size: 26 });
  d.shape("repeat", 930, 610, 870, 110, S.code, "Unchanged listing, same prompts:\nevery call is served from the cache", { size: 26 });
  legend(d, 770);
}

// 4a. Trust layer, part 1: grades and hidden answers -------------------------------------------
const trustRows = (d: Scene, rows: [string, string, string][], y0: number, h: number, gap: number) => {
  d.text("h.model", 0, y0 - 46, "The model says", 28, { color: C.orange });
  d.text("h.code", 780, y0 - 46, "Code checks it before anyone sees it", 28, { color: C.green });
  rows.forEach(([id, model, code], i) => {
    const y = y0 + i * (h + gap);
    d.shape(`${id}.m`, 0, y, 640, h, S.model, model);
    d.shape(`${id}.c`, 780, y, 1020, h, S.code, code);
    d.arrow(`${id}.a`, { id: `${id}.m`, side: "right" }, { id: `${id}.c`, side: "left" });
  });
};

{
  const d = scene("04a-trust-layer");
  d.title("Nothing the model says reaches the user without passing code", "Trust layer 1/2: grades and hidden answers.");
  trustRows(
    d,
    [
      ["quote", "Each answer comes with quotes\nand the field id they came from", "A quote must appear in the field it cites.\nFound in another field: kept, the citation is corrected.\nFound nowhere: dropped."],
      ["answer", "Status: answered or partial", "No quote survived → missing, flagged unverified.\nAn answer without proof doesn't count."],
      ["contra", "Status: contradicted", "Needs verified quotes from 2 different fields\n(title says 6 pens, description says 3).\nOnly one side proven → answered, flagged."],
      ["na", "Status: not applicable", "Allowed only for conditional questions (erasable, scent).\nAnything else → missing. The model can't dodge a question."],
      ["hidden", "Vision: claims printed in images,\nand whether the text covers each", "A hidden answer needs 2 signals to agree: the verified text\ngrade is missing or partial AND an image claim answers\nthat question. “In text” needs a verified quote."],
    ],
    200,
    112,
    26,
  );
}

// 4b. Trust layer, part 2: briefs and proof -----------------------------------------------------
{
  const d = scene("04b-trust-layer");
  d.title("Fixes are checked the same way", "Trust layer 2/2: briefs, the faithfulness judge, contradictions and review labels.");
  trustRows(
    d,
    [
      ["brief", "Brief drafts for the top 8 gaps", "Sources must exist in the listing or its image claims.\nEvery number must appear in a source, or the draft\nbecomes a request to the brand."],
      ["judge", "Faithfulness judge:\nunsupported statements", "It can only remove claims, never add them.\nA hidden answer is moved word for word:\nthe brand's image text, chosen in code."],
      ["contra", "Grade: contradicted", "Never guessed, never drafted. The brand is asked:\n“Which is right: X or Y?”"],
      ["proof", "Review labels: supports, contradicts,\nmixed, unrelated", "Index range and label enum checked. Rates in code with\na Wilson 95% interval; under 30 matching reviews:\n“not enough evidence”."],
    ],
    200,
    112,
    26,
  );
  d.shape(
    "example",
    0,
    740,
    1800,
    140,
    S.callout,
    "Real example, hero listing. Image: “Each Pen is Sealed with Wax to Prevent ink from Drying”\nModel's draft: “... to prevent ink from drying out and leaking”\nThe judge flagged “and leaking”, so the draft was held back.",
    { size: 24 },
  );
}

// 5. Any category -------------------------------------------------------------------------------
{
  const d = scene("05-any-category");
  d.title("Any category: where the questions come from", "Question sets are data, one per category, shared by every audit in it.");
  d.shape("path", 0, 150, 400, 130, S.box, "Listing's category path\nOffice Products > … >\nGel Ink Rollerball Pens");
  d.shape("resolve", 480, 150, 400, 130, S.code, "Resolve question set\ndeepest category first");
  d.shape("found", 980, 130, 300, 170, S.box, "Set found?", { type: "diamond" });
  d.shape("use", 1400, 150, 400, 130, S.code, "Use it\n(the report says if it's mined\nor estimated, and reviewed)");
  d.shape("store", 480, 380, 360, 130, S.store, "Question sets\nfixtures/intents/*.json");
  d.shape("estimate", 950, 380, 400, 130, S.model, "No set: estimate one now from\nthe listing + competitors (1 call),\nequal weights, “estimated”", { size: 21 });
  d.shape("examples", 1400, 350, 400, 190, S.note, "Real sets\ngel pens: 600 reviews → 23\nquestions, reviewed by hand\npencils: 16 questions, 93% cov.\nboards: 15 questions, 97% cov.\nwater bottles: estimated", { size: 21 });

  d.arrow("a1", { id: "path", side: "right" }, { id: "resolve", side: "left" });
  d.arrow("a2", { id: "resolve", side: "right" }, { id: "found", side: "left" });
  d.arrow("a3", { id: "found", side: "right" }, { id: "use", side: "left" }, { label: "yes" });
  d.arrow("a4", { id: "found", side: "bottom" }, { id: "estimate", side: "top", t: -0.05 }, { label: "no" });
  d.arrow("a5", { id: "estimate", side: "left" }, { id: "store", side: "right" }, { label: "saved" });
  d.arrow("a6", { id: "store", side: "top", t: 0.055 }, { id: "resolve", side: "bottom" }, { label: "read" });

  d.text("lane", 0, 597, "Once per category, offline, when reviews exist: bun apps/cli/src/mine.ts", 24, { color: C.muted });
  const mY = 645;
  const MW = 330;
  const mx = (i: number) => i * (MW + 37.5);
  d.shape("sample", mx(0), mY, MW, 140, S.code, "Sample\n60 products × 10\nmost-helpful reviews");
  d.shape("extract", mx(1), mY, MW, 140, S.model, "Extract needs\nbatches of 150 reviews\n(4 calls for 600)");
  d.shape("group", mx(2), mY, MW, 140, S.model, "Group into questions\nkind, rubric, members\n(1 call)");
  d.shape("count", mx(3), mY, MW, 140, S.code, "Count in code\ndistinct reviews per\nquestion, not mentions");
  d.shape("drop", mx(4), mY, MW, 140, S.code, "Drop rare questions\nunder max(3, 0.5%);\nsave, reviewed: false");
  d.arrow("m1", { id: "sample", side: "right" }, { id: "extract", side: "left" });
  d.arrow("m2", { id: "extract", side: "right" }, { id: "group", side: "left" });
  d.arrow("m3", { id: "group", side: "right" }, { id: "count", side: "left" });
  d.arrow("m4", { id: "count", side: "right" }, { id: "drop", side: "left" });
  d.arrow("m5", { id: "drop", side: "top" }, { id: "store", side: "bottom", t: 0.4 }, {
    via: [
      [mx(4) + MW / 2, 570],
      [804, 570],
    ],
    dashed: true,
    label: "writes",
    labelAt: [1300, 570],
  });
  legend(d, 830);
}

// 6. Job lifecycle -----------------------------------------------------------------------------
{
  const d = scene("06-job-lifecycle");
  d.title("Audit job lifecycle", "One audit row in MySQL, one BullMQ job with the same id. Every path ends in done or failed.");
  d.shape("submit", 0, 300, 250, 110, S.box, "POST /v1/audits\nrow saved first");
  d.shape("queued", 420, 290, 260, 130, S.state, "queued", { type: "ellipse", size: 30 });
  d.shape("running", 900, 290, 260, 130, S.state, "running", { type: "ellipse", size: 30 });
  d.shape("done", 1480, 130, 260, 120, S.done, "done", { type: "ellipse", size: 30 });
  d.shape("failed", 1480, 500, 260, 120, S.failed, "failed", { type: "ellipse", size: 30 });

  d.arrow("e.enqueue", { id: "submit", side: "right" }, { id: "queued", side: "left" }, { label: "job\nqueued" });
  d.arrow("e.pick", { id: "queued", side: "right" }, { id: "running", side: "left" }, { label: "worker\npicks it" });
  d.arrow("e.done", { id: "running", side: "right", t: -0.25 }, { id: "done", side: "left" }, { label: "finished" });
  d.arrow("e.quota", { id: "running", side: "top", t: -0.15 }, { id: "queued", side: "top", t: 0.15 }, {
    via: [
      [991, 180],
      [589, 180],
    ],
    label: "daily quota: delayed until reset\n(stays queued, note on the row)",
    labelAt: [790, 180],
  });
  d.arrow("e.retry", { id: "running", side: "bottom", t: -0.15 }, { id: "queued", side: "bottom", t: 0.15 }, {
    via: [
      [991, 520],
      [589, 520],
    ],
    label: "retryable error: backoff, retry",
    labelAt: [790, 520],
  });
  d.arrow("e.exhausted", { id: "running", side: "right", t: 0.2 }, { id: "failed", side: "left", t: -0.25 }, { label: "3 attempts used:\nprovider_unavailable" });
  d.arrow("e.bad", { id: "running", side: "bottom", t: 0.3 }, { id: "failed", side: "left", t: 0.25 }, {
    via: [[1108, 590]],
    label: "bad input: fails at once",
    labelAt: [1290, 590],
  });
  d.arrow("e.enqfail", { id: "submit", side: "bottom" }, { id: "failed", side: "bottom", t: -0.2 }, {
    via: [
      [125, 680],
      [1558, 680],
    ],
    label: "Redis down: enqueue_failed",
    labelAt: [800, 680],
  });

  const nY = 750;
  d.shape("rescore", 0, nY, 420, 140, S.note, "POST /v1/rescore: hash\nunchanged → skipped; in flight\n→ that audit's id; else new", { size: 21 });
  d.shape("bulk", 460, nY, 420, 140, S.note, "Bulk job: one audit row\nper ASIN; progress is\ncounted from those rows", { size: 21 });
  d.shape("hooks", 920, nY, 420, 140, S.note, "Webhooks audit.completed\nand audit.failed,\nHMAC-SHA256 signed", { size: 21 });
  d.shape("crash", 1380, nY, 420, 140, S.note, "Worker crash: the job\nstalls; the failed listener\nmarks the audit failed", { size: 21 });
  d.arrow("e.crash", { id: "crash", side: "top", t: 0.15 }, { id: "failed", side: "bottom", t: 0.25 }, { dashed: true });
}

// 7. Evals and cost -----------------------------------------------------------------------------
{
  const d = scene("07-evals-and-cost");
  d.title("Evals and cost", "Prompts and models can't silently get worse: CI replays the gold set on every change.");
  d.shape("gold", 0, 150, 380, 170, S.box, "Gold set\n134 grade pairs\n60 proof pairs\ndrafts pending owner review");
  d.shape("run", 470, 150, 380, 170, S.code, "bun evals\nreplays recorded\nmodel answers, offline");
  d.shape("metrics", 940, 150, 380, 170, S.code, "accuracy, per-status F1,\nverifier effect,\ncost per audit");
  d.shape("baseline", 1420, 150, 380, 170, S.box, "baseline.json\naccuracy + set sizes\n+ prompt versions");
  d.shape("check", 940, 390, 860, 120, S.code, "bun evals --check fails CI when accuracy drops more\nthan 2 points, or the set or prompt version changed");
  d.shape("prov", 0, 390, 850, 120, S.note, "Provisional: all 134 grade labels and 20 of 60 proof\nlabels are drafts until the owner reviews them.");

  d.arrow("e1", { id: "gold", side: "right" }, { id: "run", side: "left" });
  d.arrow("e2", { id: "run", side: "right" }, { id: "metrics", side: "left" });
  d.arrow("e3", { id: "metrics", side: "right" }, { id: "baseline", side: "left" });
  d.arrow("e4", { id: "baseline", side: "bottom" }, { id: "check", side: "top", t: 0.28 });
  d.arrow("e5", { id: "metrics", side: "bottom" }, { id: "check", side: "top", t: -0.28 });

  d.shape("n.grade", 0, 570, 560, 180, S.box, "Grading\n85.1%\non 134 pairs (model alone 85.8%)", { size: 26 });
  d.shape("n.proof", 620, 570, 560, 180, S.box, "Proof labels\n92.2% on clear cases\n86.7% on all 4 labels, 60 pairs", { size: 26 });
  d.shape("n.cost", 1240, 570, 560, 180, S.model, "Cost per audit\n~10.6 requests, $0.03\non paid Flash-Lite, $0 free", { size: 26 });
  d.text("fn", 0, 790, "Verifier effect: it changed 1 of 134 statuses (away from gold). Evidence: 97.2% of cited fields carry the answer.", 22, { color: C.muted });
}

mkdirSync(OUT, { recursive: true });
for (const s of scenes) {
  writeFileSync(join(OUT, `${s.name}.excalidraw`), `${JSON.stringify(s.toJSON(), null, 2)}\n`);
  console.log(`wrote diagrams/${s.name}.excalidraw (${s.elements.length} elements)`);
}
