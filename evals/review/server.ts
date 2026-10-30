#!/usr/bin/env bun
/**
 * bun evals:review
 *
 * A local page for reviewing the gold labels at http://127.0.0.1:5199. Each decision is written
 * straight back to evals/gold/*.jsonl (one line changed, atomically), so closing the tab loses
 * nothing. It only listens on 127.0.0.1 and writes no other file.
 */
import { join } from "node:path";
import { ROOT, readJsonl, type GoldGrade, type GoldProof } from "../lib";
import { GRADES_PATH, PROOF_PATH, loadContext } from "./data";
import { applyGradeDecision, applyProofDecision, gradeKey, updateRow, type GradeDecision, type ProofDecision } from "./jsonl";

const PORT = 5199;
const HOST = "127.0.0.1";
const PAGE = join(import.meta.dir, "page.html");

console.log("Replaying the recorded grades...");
const context = await loadContext();

// One write at a time, so two quick decisions can't race on the same file.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Blocks writes from other sites: a JSON body forces a CORS preflight, and the origin must be this page. */
function allowedWrite(req: Request): boolean {
  const origin = req.headers.get("origin");
  const okOrigin = !origin || origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
  return okOrigin && (req.headers.get("content-type") ?? "").startsWith("application/json");
}

async function runEvals(): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn([process.execPath, "run", "evals"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  // bun echoes the script it runs ("$ bun evals/run.ts") on stderr; drop that line.
  const output = `${out}${err}`.split("\n").filter((l) => !l.startsWith("$ ")).join("\n").trim();
  return { code, output };
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/") return new Response(Bun.file(PAGE), { headers: { "content-type": "text/html; charset=utf-8" } });
      if (req.method === "GET" && path === "/api/data") {
        const [grades, proof] = await Promise.all([readJsonl<GoldGrade>(GRADES_PATH), readJsonl<GoldProof>(PROOF_PATH)]);
        return json({ ...context, grades, proof });
      }
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      if (!allowedWrite(req)) return json({ error: "forbidden" }, 403);

      const grade = path.match(/^\/api\/grades\/(\d+)$/);
      if (grade) {
        const body = (await req.json()) as GradeDecision & { key: string };
        const row = await serial(() => updateRow<GoldGrade>(GRADES_PATH, Number(grade[1]), body.key, gradeKey, (r) => applyGradeDecision(r, body)));
        return json({ row });
      }
      const proof = path.match(/^\/api\/proof\/(\d+)$/);
      if (proof) {
        const body = (await req.json()) as ProofDecision & { key: string };
        const row = await serial(() => updateRow<GoldProof>(PROOF_PATH, Number(proof[1]), body.key, (r) => r.id, (r) => applyProofDecision(r, body)));
        return json({ row });
      }
      if (path === "/api/evals") return json(await serial(runEvals));
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  },
});

console.log(`Reviewing gold labels at http://${server.hostname}:${server.port}  (Ctrl+C to stop)`);
