import { expect, test, type Page } from "@playwright/test";

const QUOTE = "Alexa recommendation visibility is not currently available as a standalone metric in Seller Central.";
const BLOG_URL = "https://salesduo.com/blog/alexa-for-shopping-optimization/";
const shot = (name: string) => `e2e/screenshots/${name}.png`;

/** Fails the test on any console error or uncaught exception. Listing images load from Amazon and may be offline, so those are ignored. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.location().url.includes("media-amazon.com")) return;
    errors.push(m.text());
  });
  return errors;
}

/** Full-page screenshot from the top, so the sticky header doesn't land mid-page. */
async function fullShot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot(name), fullPage: true });
}

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

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

test("the hero audit runs, then shows score, hidden answers and the fix list", async ({ page }) => {
  await openHero(page);
  await expect(page.getByTestId("audit-status")).toHaveText(/Queued|Running/);
  await page.screenshot({ path: shot("02-audit-running") });

  await expect(page.getByTestId("score")).toHaveText("52", { timeout: 10_000 });
  await expect(page.getByText("Answers 8 of 15 questions")).toBeVisible();
  await expect(page.getByText("Questions mined from 600 reviews").first()).toBeVisible();

  const hidden = page.getByTestId("hidden-answer");
  await expect(hidden).toHaveCount(2);
  await expect(hidden.filter({ hasText: "No Smear: Perfect for Left-Handed" })).toHaveCount(1);

  await expect(page.getByTestId("fix").first().getByTestId("draft")).toHaveText("Smooth Writing without Skipping");
  await expect(page.getByText("Held back: added claims the brand never made.")).toBeVisible();
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

test("an unknown ASIN ends in a clear failure", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Amazon ASIN").fill("B0ZZZZZZZZ");
  await page.getByRole("button", { name: "Run audit" }).click();
  await expect(page.getByRole("alert")).toContainText("failed", { timeout: 10_000 });
  await expect(page.getByRole("alert")).toContainText("B0ZZZZZZZZ");
  await page.screenshot({ path: shot("06-audit-failed") });
});

test("the widget shows a score and exactly three gaps", async ({ page }) => {
  await page.goto("/widget");
  await page.getByLabel("ASIN").fill("B0C9W8DD9S");
  await page.getByRole("button", { name: "Check my listing" }).click();
  await expect(page.getByTestId("widget-result")).toContainText("52", { timeout: 10_000 });
  await expect(page.getByTestId("widget-gaps").locator("li")).toHaveCount(3);
  await expect(page.getByText("Get the full report by email")).toBeVisible();
  await fullShot(page, "07-widget");
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

    await page.goto("/widget");
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
