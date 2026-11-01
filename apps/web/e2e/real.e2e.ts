/**
 * The real stack: web app in real mode → API → queue → worker → MySQL, with model calls replayed
 * from fixtures/llm. See playwright.real.config.ts. Screenshots here are the committed ones.
 */
import { expect, test, type Page } from "@playwright/test";
import { BLOG_URL, noHorizontalScroll, QUOTE, shooter, watchConsole } from "./helpers";

// The committed screenshots (used in the README) only change when asked: UPDATE_SCREENSHOTS=1.
const shots = shooter(process.env.UPDATE_SCREENSHOTS ? "e2e/screenshots" : "test-results/real-screenshots");
const UUID = /\/audits\/[0-9a-f-]{36}$/;

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchConsole(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function pick(page: Page, source: "Live page" | "Saved (2023 dataset)", chip: RegExp) {
  await page.goto("/");
  await page.getByRole("radio", { name: source }).click();
  await page.getByRole("button", { name: chip }).click();
  await expect(page).toHaveURL(UUID);
}

test("the hero audit runs from the landing page to the report", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("blockquote").first()).toHaveText(`“${QUOTE}”`);
  await expect(page.getByRole("link", { name: /Alexa for Shopping Optimization 2026/ })).toHaveAttribute("href", BLOG_URL);
  await expect(page.getByRole("button", { name: /Ddaowanx/ })).toBeVisible();
  // The example's photo loads from Amazon and fades in; let it settle before the screenshot.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  await shots.full(page, "01-landing");

  await page.getByRole("button", { name: /Ddaowanx/ }).click();
  await expect(page).toHaveURL(UUID);
  // The worker replays recorded calls, so this can finish fast; catch the progress view if it's there.
  const status = page.getByTestId("audit-status");
  if (await status.isVisible().catch(() => false)) await shots.view(page, "02-audit-running");

  await expect(page.getByTestId("score")).toHaveText("52");
  await expect(page.getByText("Answers 8 of 15 questions")).toBeVisible();
  const hidden = page.getByTestId("hidden-answer");
  await expect(hidden).toHaveCount(2);
  await expect(hidden.filter({ hasText: "No Smear: Perfect for Left-Handed" })).toHaveCount(1);
  await expect(page.getByTestId("fix").first().getByTestId("draft")).toHaveText("Smooth Writing without Skipping");
  await expect(page.getByTestId("fix").first()).toContainText("4 of 4 competitors answer it (1 partly)");
  await expect(page.getByTestId("proof-absent")).toContainText("Live listings come without review text");
  await shots.full(page, "03-report-hero");
  // The top of the report and the hidden answers on their own, for the README.
  await shots.view(page, "16-report-top");
  await shots.section(page, "#hidden", "17-hidden-answers");

  await page.getByRole("button", { name: "Send to Studio" }).click();
  await expect(page.getByRole("dialog")).toContainText("Smooth Writing without Skipping");
  await shots.view(page, "04-send-to-studio");
});

test("a failed poll doesn't stop the audit page: it retries and reaches the report", async ({ page }) => {
  // The first two polls of the audit get a 503, as if the API restarted mid-audit.
  let failed = 0;
  await page.route(/\/v1\/audits\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() === "GET" && failed < 2) {
      failed++;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "Service unavailable" } }) });
    }
    return route.continue();
  });
  await pick(page, "Saved (2023 dataset)", /U Brands/);
  await expect(page.getByTestId("score")).toHaveText("84");
  expect(failed).toBe(2);
  // The browser logs each 503 it was sent on purpose; anything else still fails the test.
  errors = errors.filter((e) => !e.includes("503"));
});

test("the Pentel dataset audit shows promise vs proof, with the leak claim contested", async ({ page }) => {
  await pick(page, "Saved (2023 dataset)", /Pentel.*Gel Ink/);
  await expect(page.getByTestId("score")).toHaveText("61");
  const leaking = page.locator('[data-testid="proof-claim"][data-intent="leaking"]');
  await expect(leaking).toHaveAttribute("data-verdict", "contested");
  await expect(leaking).toContainText("“no globs”");
  await expect(leaking).toContainText("33 of 62 reviews that discuss it contradict it");
  await expect(page.getByText("not of all buyers")).toBeVisible();
  await shots.full(page, "05-report-proof");
  await shots.section(page, "#proof", "06-proof-section");
});

test("an estimated category is labelled as estimated", async ({ page }) => {
  // CamelBak isn't one of the featured chips, so type its ASIN like a user would.
  await page.goto("/");
  await page.getByRole("radio", { name: "Saved (2023 dataset)" }).click();
  await page.getByLabel("Amazon ASIN").fill("B00P6N6LC2");
  await page.getByRole("button", { name: "Run audit" }).click();
  await expect(page).toHaveURL(UUID);
  await expect(page.getByTestId("score")).toHaveText("60");
  await expect(page.getByText("Estimated questions", { exact: true })).toBeVisible();
  await shots.full(page, "07-report-estimated");
});

test("the audits list shows the audits from the app", async ({ page }) => {
  await page.goto("/audits");
  await expect(page.getByRole("link", { name: /Ddaowanx/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Pentel Energel/i }).first()).toBeVisible();
  await shots.full(page, "08-audits");
});

test("a bulk job of 3 dataset ASINs reaches done", async ({ page }) => {
  await page.goto("/bulk");
  await page.getByLabel("Name").fill("Dataset trio");
  await page.getByLabel("ASINs").fill("B09YP9YYZG\nB0143LMAEK\nB09VD1Z3TK");
  await page.getByRole("radio", { name: "Saved (2023 dataset)" }).click();
  await page.getByRole("button", { name: "Start 3 audits" }).click();
  await expect(page.getByTestId("bulk-progress")).toHaveText("3 of 3 done", { timeout: 60_000 });
  await expect(page.getByRole("link", { name: /Open B09VD1Z3TK/ })).toBeVisible();
  await shots.full(page, "09-bulk");
});

test("the widget shows 3 gaps with competitor counts and takes an email", async ({ page }) => {
  await page.goto("/widget.html");
  await page.getByLabel("ASIN").fill("B0C9W8DD9S");
  await page.getByRole("button", { name: "Check my listing" }).click();
  await expect(page.getByTestId("widget-result")).toContainText("52");
  const gaps = page.getByTestId("widget-gaps").locator("li");
  await expect(gaps).toHaveCount(3);
  await expect(gaps.first()).toContainText("4 of 4 competitors answer it");
  await expect(gaps.first()).toContainText("only in an image");
  await shots.full(page, "10-widget");

  await page.getByLabel("Get the full report by email").fill("brand@example.com");
  await page.getByRole("button", { name: "Send me the report" }).click();
  await expect(page.getByTestId("email-captured")).toContainText("brand@example.com");
  await shots.view(page, "11-widget-email");
});

test("a widget audit of an unknown product shows the public reason", async ({ page }) => {
  await page.goto("/widget.html");
  await page.getByLabel("ASIN").fill("B0ZZZZZZZZ");
  await page.getByRole("button", { name: "Check my listing" }).click();
  await expect(page.getByTestId("widget-failed")).toHaveText("We can't audit this product yet. Try one of the example products.");
});

test("the integrations page loads the hero's real history", async ({ page }) => {
  await page.goto("/integrations");
  const chart = page.locator('svg[aria-label^="Score history"]');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute("aria-label", /52/);
  await page.getByRole("button", { name: "Send re-score" }).click();
  await expect(page.getByText(/Skipped: the content hasn't changed|Queued a new audit/)).toBeVisible();
  await shots.full(page, "12-integrations");
});

test("an unknown ASIN shows the failure message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Amazon ASIN").fill("B0ZZZZZZZZ");
  // An ASIN that isn't saved is fetched live without any opt-in, and the form says so first.
  await expect(page.getByText(/New product: we'll fetch it from Amazon/)).toBeVisible();
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/v1\/audits$/.test(r.url()));
  await page.getByRole("button", { name: "Run audit" }).click();
  expect((await sent).postDataJSON()).toMatchObject({ asin: "B0ZZZZZZZZ", source: "serpapi", live: true });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The audit of B0ZZZZZZZZ failed");
  await expect(alert).toContainText("No serpapi listing for B0ZZZZZZZZ");
  await shots.view(page, "13-audit-failed");
});

test.describe("mobile, 375px", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("report and widget fit the screen", async ({ page }) => {
    await pick(page, "Live page", /Ddaowanx/);
    await expect(page.getByTestId("score")).toHaveText("52");
    await noHorizontalScroll(page);
    await shots.full(page, "14-mobile-report");

    await page.goto("/widget.html");
    await noHorizontalScroll(page);
    await shots.full(page, "15-mobile-widget");
  });
});
