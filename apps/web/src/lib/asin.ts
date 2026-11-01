import { Asin } from "@aloud/contracts";

/**
 * The ASIN from what a person pasted: the ASIN itself, or an Amazon product link in any of its
 * shapes (amazon.com/dp/…, /gp/product/…, /gp/aw/d/…, a.co is a redirect so it can't be read).
 * Returns null when there's no ASIN in it.
 */
export function asinFromInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (Asin.safeParse(upper).success) return upper;
  const inPath = text.match(/\/(?:dp|gp\/product|gp\/aw\/d|product-reviews|exec\/obidos\/asin)\/([A-Z0-9]{10})(?=[/?#&]|$)/i);
  if (inPath && Asin.safeParse(inPath[1]!.toUpperCase()).success) return inPath[1]!.toUpperCase();
  const inQuery = text.match(/[?&]asin=([A-Z0-9]{10})\b/i);
  if (inQuery && Asin.safeParse(inQuery[1]!.toUpperCase()).success) return inQuery[1]!.toUpperCase();
  return null;
}

/** Why the input isn't usable, said in a way a seller can act on. */
export function asinInputError(raw: string): string | null {
  if (asinFromInput(raw)) return null;
  if (/a\.co\/|amzn\.to\//i.test(raw)) return "Short links can't be read. Open it and paste the full amazon.com link.";
  if (/amazon\./i.test(raw)) return "No ASIN in that link. Paste the product page link, the one with /dp/ in it.";
  return "Paste an Amazon product link, or the 10-character ASIN starting with B0.";
}
