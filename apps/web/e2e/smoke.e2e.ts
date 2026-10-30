import { expect, test, type Page } from "@playwright/test";
import { BLOG_URL, noHorizontalScroll, QUOTE, shooter, watchConsole } from "./helpers";

/** Mock-mode screenshots stay out of git; the committed ones in e2e/screenshots come from the real stack. */
const shots = shooter("test-results/mock-screenshots");
const shot = shots.path;
const fullShot = shots.full;

async function openHero(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Ddaowanx/ }).click();
  await expect(page).toHaveURL(/\/audits\/aud_/);
}

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchConsole(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("landing quotes the SalesDuo blog word for word, with the link", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("blockquote").first()).toHaveText(`“${QUOTE}”`);
  const link = page.getByRole("link", { name: "Alexa for Shopping Optimization 2026: The Complete Guide for Amazon Sellers" });
  await expect(link).toHaveAttribute("href", BLOG_URL);
  await expect(page.getByText("This doesn't measure Alexa. It measures what Alexa reads.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Ddaowanx/ })).toBeVisible();
  await fullShot(page, "01-landing");
});

test("an invalid ASIN is caught before anything is sent", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Amazon ASIN").fill("12345");
  await page.getByRole("button", { name: "Run audit" }).click();
  await expect(page.getByLabel("Amazon ASIN")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL("/");
});

test("the form says what a run will do before it starts", async ({ page }) => {
  await page.goto("/");
  const asin = page.getByLabel("Amazon ASIN");
  await asin.fill("B0C9W8DD9S");
  await expect(page.getByText("Saved product: the audit is ready in seconds.")).toBeVisible();
  // A new ASIN would be fetched live; demo mode has no API to fetch it with, and says so.
  await asin.fill("B0ZZZZZZZZ");
  await expect(page.getByText(/New product: demo mode only has the saved products/)).toBeVisible();
});

test("the hero audit runs, then shows score, hidden answers and the fix list", async ({ page }) => {
  await openHero(page);
  await expect(page.getByTestId("audit-status")).toHaveText(/Queued|Running/);
  await page.screenshot({ path: shot("02-audit-running") });

  await expect(page.getByTestId("score")).toHaveText("52", { timeout: 10_000 });
  await expect(page.getByTestId("score-band")).toHaveText("Partly ready");
  await expect(page.getByText("Answers 8 of 15 questions")).toBeVisible();
  await expect(page.getByText("Questions mined from 600 reviews").first()).toBeVisible();

  const hidden = page.getByTestId("hidden-answer");
  await expect(hidden).toHaveCount(2);
  await expect(hidden.filter({ hasText: "No Smear: Perfect for Left-Handed" })).toHaveCount(1);

  await expect(page.getByTestId("fix").first().getByTestId("draft")).toHaveText("Smooth Writing without Skipping");
  await expect(page.locator("#fix-leaking").getByText("Held back: added claims the brand never made.")).toBeVisible();

  // The verdict leads, then the first three fixes, before any evidence.
  await expect(page.getByTestId("top-fixes").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("top-fixes").locator("li").first()).toContainText("Smooth Writing without Skipping");
  await expect(page.getByTestId("top-fixes").locator("li").first()).toContainText("+20 points");

  // The competitor matrix shows the gaps first and the rest on request.
  const matrix = page.locator("#competitors tbody tr");
  await expect(matrix).toHaveCount(7);
  await page.getByRole("button", { name: "Show all 15 questions" }).click();
  await expect(matrix).toHaveCount(15);
  await fullShot(page, "03-report-hero");

  // Selecting a question marks its quote in the listing panel.
  await page.getByRole("button", { name: "What is the tip size or line width?" }).click();
  await expect(page.locator('[data-field="attr.line_size"] mark')).toHaveText("0.5 Millimeters");

  await page.getByRole("button", { name: "Send to Studio" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText('"auditId"');
  await expect(dialog).toContainText("Smooth Writing without Skipping");
  await page.screenshot({ path: shot("04-send-to-studio") });
});

test("an estimated category is labelled as estimated", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Saved (2023 dataset)" }).click();
  await page.getByRole("button", { name: /CamelBak/ }).click();
  await expect(page.getByTestId("score")).toHaveText("60", { timeout: 10_000 });
  await expect(page.getByText("Estimated questions", { exact: true })).toBeVisible();
  await expect(page.getByText("(estimated)").first()).toBeVisible();
  await fullShot(page, "05-report-estimated");
});

test("the Pentel dataset audit checks the listing's claims against reviews", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Saved (2023 dataset)" }).click();
  await page.getByRole("button", { name: /Pentel.*Gel Ink/ }).click();
  await expect(page.getByTestId("score")).toHaveText("61", { timeout: 10_000 });
  const leaking = page.locator('[data-testid="proof-claim"][data-intent="leaking"]');
  await expect(leaking).toHaveAttribute("data-verdict", "contested");
  await expect(leaking).toContainText("33 of 62 reviews that discuss it contradict it");
  await expect(page.getByText("not of all buyers")).toBeVisible();
  await page.locator("#proof").screenshot({ path: shot("05b-proof") });
});

test("a live listing says why promise vs proof wasn't checked", async ({ page }) => {
  await openHero(page);
  await expect(page.getByTestId("proof-absent")).toContainText("Live listings come without review text", { timeout: 10_000 });
});

test("an unknown ASIN ends in a clear failure", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Amazon ASIN").fill("B0ZZZZZZZZ");
  await page.getByRole("button", { name: "Run audit" }).click();
  await expect(page.getByRole("alert")).toContainText("failed", { timeout: 10_000 });
  await expect(page.getByRole("alert")).toContainText("B0ZZZZZZZZ");
  await page.screenshot({ path: shot("06-audit-failed") });
});

test("the widget shows a score and exactly three gaps", async ({ page }) => {
  await page.goto("/widget.html");
  await page.getByLabel("ASIN").fill("B0C9W8DD9S");
  await page.getByRole("button", { name: "Check my listing" }).click();
  await expect(page.getByTestId("widget-result")).toContainText("52", { timeout: 10_000 });
  await expect(page.getByTestId("widget-band")).toHaveText("Partly ready");
  await expect(page.getByTestId("widget-gaps").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("widget-gaps").locator("li").first()).toContainText("4 of 4 competitors answer it");
  await fullShot(page, "07-widget");
  await page.getByLabel("Get the full report by email").fill("brand@example.com");
  await page.getByRole("button", { name: "Send me the report" }).click();
  await expect(page.getByTestId("email-captured")).toContainText("brand@example.com");
});

test("a widget check parked behind the daily quota says so and takes an email", async ({ page }) => {
  await page.goto("/widget.html");
  await page.getByLabel("ASIN").fill("B0QUOTA000");
  await page.getByRole("button", { name: "Check my listing" }).click();
  const waiting = page.getByTestId("widget-waiting");
  await expect(waiting).toContainText("The check is busy right now. Your result will be ready later today");
  // No spinner while it waits: the button is free again.
  await expect(page.getByRole("button", { name: "Check my listing" })).toBeEnabled();
  await fullShot(page, "07b-widget-quota");
  await page.getByLabel("Get the result by email").fill("brand@example.com");
  await page.getByRole("button", { name: "Send me the report" }).click();
  await expect(page.getByTestId("email-captured")).toContainText("brand@example.com");
});

test("an app audit parked behind the daily quota shows the reset time", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Amazon ASIN").fill("B0QUOTA000");
  await page.getByRole("button", { name: "Run audit" }).click();
  await expect(page.getByTestId("audit-status")).toHaveText("Queued");
  await expect(page.getByTestId("audit-note")).toContainText(/Waiting for the model's daily quota to reset at .+ (today|tomorrow)/);
  await page.screenshot({ path: shot("06b-audit-quota") });
});

test("audits list, bulk progress and integrations render", async ({ page }) => {
  await page.goto("/audits");
  await expect(page.getByRole("link", { name: /Ddaowanx/ })).toBeVisible();
  await fullShot(page, "08-audits");

  await page.goto("/bulk");
  await page.getByRole("button", { name: /Start 5 audits/ }).click();
  await expect(page.getByTestId("bulk-progress")).toContainText("of 5 done");
  await fullShot(page, "09-bulk-running");
  await expect(page.getByTestId("bulk-progress")).toHaveText("5 of 5 done", { timeout: 15_000 });
  await fullShot(page, "10-bulk-done");

  await page.goto("/integrations");
  await expect(page.getByText("AI shelf readiness")).toBeVisible();
  await expect(page.getByText("This edit took answerability 54 to 81")).toBeVisible();
  await page.getByRole("button", { name: "Send re-score" }).click();
  await expect(page.getByText(/Skipped: the content hasn't changed/)).toBeVisible();
  await expect(page.getByText("Smooth Writing without Skipping").first()).toBeVisible();
  await fullShot(page, "11-integrations");
});

test.describe("mobile, 375px", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("landing, report and widget fit the screen", async ({ page }) => {
    await page.goto("/");
    await noHorizontalScroll(page);
    await fullShot(page, "12-mobile-landing");

    await page.getByRole("button", { name: /Ddaowanx/ }).click();
    await expect(page.getByTestId("score")).toHaveText("52", { timeout: 10_000 });
    await noHorizontalScroll(page);
    await fullShot(page, "13-mobile-report");

    await page.goto("/widget.html");
    await page.getByLabel("ASIN").fill("B0C9W8DD9S");
    await page.getByRole("button", { name: "Check my listing" }).click();
    await expect(page.getByTestId("widget-gaps").locator("li")).toHaveCount(3, { timeout: 10_000 });
    await noHorizontalScroll(page);
    await fullShot(page, "14-mobile-widget");

    for (const path of ["/audits", "/bulk", "/integrations"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await noHorizontalScroll(page);
    }
  });
});
