import { expect, test } from "bun:test";
import { asinFromInput, asinInputError } from "./asin";

test("an ASIN on its own, in any case", () => {
  expect(asinFromInput(" b0c9w8dd9s ")).toBe("B0C9W8DD9S");
});

test("product links in the shapes Amazon uses", () => {
  expect(asinFromInput("https://www.amazon.com/Ddaowanx-Retractable-Quick-Black/dp/B0C9W8DD9S/ref=sr_1_3?keywords=gel+pens")).toBe("B0C9W8DD9S");
  expect(asinFromInput("amazon.com/dp/B0C9W8DD9S")).toBe("B0C9W8DD9S");
  expect(asinFromInput("https://www.amazon.co.uk/gp/product/B087VVWWGG?th=1")).toBe("B087VVWWGG");
  expect(asinFromInput("https://www.amazon.com/gp/aw/d/B00275BB6S")).toBe("B00275BB6S");
  expect(asinFromInput("https://www.amazon.com/product-reviews/B00B10MKDI/ref=cm_cr_dp")).toBe("B00B10MKDI");
  expect(asinFromInput("https://www.amazon.com/s?k=pens&asin=B0C9W8DD9S")).toBe("B0C9W8DD9S");
});

test("nothing usable gives a reason", () => {
  expect(asinFromInput("12345")).toBeNull();
  expect(asinFromInput("https://www.amazon.com/s?k=gel+pens")).toBeNull();
  expect(asinInputError("https://a.co/d/abc123")).toMatch(/Short links/);
  expect(asinInputError("https://www.amazon.com/s?k=gel+pens")).toMatch(/\/dp\//);
  expect(asinInputError("12345")).toMatch(/B0/);
});
