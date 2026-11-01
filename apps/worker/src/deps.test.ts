import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { IntentSet } from "@aloud/core";
import { connect, dropDatabase, ensureDatabase, runMigrations, type DbHandle } from "@aloud/db";
import type { IntentSetStore } from "@aloud/pipeline";
import { dbIntentSets } from "./deps";

const DB_URL = process.env.TEST_DATABASE_URL_DEPS || "mysql://root:aloud@127.0.0.1:3317/aloud_test_deps";

const set = (categoryId: string, basis: IntentSet["basis"], question = "q"): IntentSet => ({
  categoryId,
  categoryName: categoryId,
  match: [categoryId],
  version: "v",
  basis,
  reviewed: false,
  sampleSize: 1,
  intents: [{ id: "a", kind: "spec", question, rubric: "r", frequency: 1 }],
});

/** Committed sets, as fixtures/intents would hold them. Saving here would mean the disk was used. */
const files = (sets: IntentSet[]): IntentSetStore => ({
  all: async () => sets,
  save: async () => {
    throw new Error("should save to the database, not the files");
  },
});

describe.skipIf(process.env.SKIP_INTEGRATION === "1")("question sets in the database", () => {
  let h: DbHandle;
  beforeAll(async () => {
    await dropDatabase(DB_URL);
    await ensureDatabase(DB_URL);
    h = connect(DB_URL);
    await runMigrations(h.db);
  });
  afterAll(async () => {
    await h?.close();
    await dropDatabase(DB_URL);
  });

  test("new sets are saved to the database and read back, so they survive a restart", async () => {
    const store = dbIntentSets(h.db, files([]));
    await store.save(set("cloths", "insights"), "note");
    await store.save(set("cloths", "mined", "updated"), "note");
    const again = dbIntentSets(h.db, files([]));
    expect((await again.all()).map((s) => [s.categoryId, s.basis, s.intents[0]!.question])).toEqual([["cloths", "mined", "updated"]]);
  });

  test("for one category the better basis wins; a tie keeps the committed set", async () => {
    await dbIntentSets(h.db, files([])).save(set("bags", "estimated"), "note");
    await dbIntentSets(h.db, files([])).save(set("chairs", "mined", "from db"), "note");
    const store = dbIntentSets(h.db, files([set("bags", "mined", "committed"), set("chairs", "mined", "committed"), set("pens", "mined")]));
    const byId = Object.fromEntries((await store.all()).map((s) => [s.categoryId, s.intents[0]!.question]));
    expect(byId).toEqual({ bags: "committed", chairs: "committed", cloths: "updated", pens: "q" });
  });
});
