import { expect, type Page } from "@playwright/test";

export const QUOTE = "Alexa recommendation visibility is not currently available as a standalone metric in Seller Central.";
export const BLOG_URL = "https://salesduo.com/blog/alexa-for-shopping-optimization/";

/** Collects console errors and uncaught exceptions. Listing images load from Amazon and may be offline, so those are ignored. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.location().url.includes("media-amazon.com")) return;
    errors.push(m.text());
  });
  return errors;
}

/** Screenshots into `dir`; full-page ones start from the top so the sticky header doesn't land mid-page. */
export function shooter(dir: string) {
  return {
    async full(page: Page, name: string) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    },
    async view(page: Page, name: string) {
      await page.screenshot({ path: `${dir}/${name}.png` });
    },
    /**
     * One section on its own. Cut from a full-page shot rather than an element shot: an element
     * taller than the window came out clipped, and the sticky header and section bar were
     * painted over it, so both are hidden for the shot.
     */
    async section(page: Page, selector: string, name: string) {
      const style = await page.addStyleTag({ content: "header.sticky, nav.sticky { visibility: hidden !important; }" });
      const box = await page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      });
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, clip: box });
      await style.evaluate((el) => (el as Element).remove());
    },
    path: (name: string) => `${dir}/${name}.png`,
  };
}

export async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/** The 2023 dataset is only offered on the Bulk page now, so a dataset audit is opened from there. */
export async function openDatasetAudit(page: Page, asin: string) {
  await page.goto("/bulk");
  await page.getByLabel("Name").fill(`Dataset ${asin}`);
  await page.getByLabel("ASINs").fill(asin);
  await page.getByRole("radio", { name: "Saved (2023 dataset)" }).click();
  await page.getByRole("button", { name: "Start 1 audits" }).click();
  await page.getByRole("link", { name: new RegExp(`Open ${asin}`) }).click({ timeout: 60_000 });
}
