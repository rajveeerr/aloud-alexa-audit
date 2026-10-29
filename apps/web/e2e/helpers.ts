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
    path: (name: string) => `${dir}/${name}.png`,
  };
}

export async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
}
