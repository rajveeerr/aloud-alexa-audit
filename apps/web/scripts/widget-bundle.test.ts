/**
 * The widget is embedded on a public page, so its bundle must never contain the internal app's
 * API key. Builds the app with a marker key and checks every file widget.html loads.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const MARKER = "widget-bundle-test-key-7f3a9c";

/** Every asset widget.html pulls in: its scripts, preloads and styles, then the imports inside those. */
function reachable(outDir: string): string[] {
  const html = readFileSync(join(outDir, "widget.html"), "utf8");
  const queue = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".js")) continue;
    const code = readFileSync(join(outDir, file), "utf8");
    for (const m of code.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) queue.push(`assets/${m[1]}`);
  }
  return [...seen];
}

describe("widget bundle", () => {
  test("never contains the API key, while the app bundle does", () => {
    const outDir = mkdtempSync(join(tmpdir(), "answerable-web-"));
    try {
      const build = Bun.spawnSync(["bunx", "vite", "build", "--outDir", outDir, "--emptyOutDir"], {
        cwd: WEB,
        env: { ...process.env, VITE_API_KEY: MARKER, VITE_USE_MOCKS: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(build.exitCode, build.stderr.toString()).toBe(0);
      expect(existsSync(join(outDir, "widget.html"))).toBe(true);

      const files = reachable(outDir);
      expect(files.some((f) => f.endsWith(".js"))).toBe(true);
      for (const f of files) expect(readFileSync(join(outDir, f), "utf8").includes(MARKER), `${f} contains the API key`).toBe(false);

      // Sanity check that the marker is findable at all: the internal app does carry it.
      const appHtml = readFileSync(join(outDir, "index.html"), "utf8");
      const appEntry = appHtml.match(/src="\/(assets\/[^"]+\.js)"/)![1]!;
      expect(readFileSync(join(outDir, appEntry), "utf8").includes(MARKER)).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
