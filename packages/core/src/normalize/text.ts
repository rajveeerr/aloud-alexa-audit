const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

/** Decodes the few HTML entities that show up in Amazon text, drops tags, collapses whitespace. */
export function cleanText(input: string): string {
  return decodeEntities(input)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Some feeds encode twice ("&amp;#39;"), so decode until nothing changes. */
function decodeEntities(input: string): string {
  let out = input;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Lowercase, punctuation stripped. Used only to compare texts, never stored. */
export function comparable(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Item Weight" and "item_weight" both become "item_weight". */
export function toKey(label: string): string {
  return label
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** "item_weight" becomes "Item weight", for the attribute text a grader reads. */
export function keyLabel(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PLACEHOLDERS = new Set(["", "0", "-", "n/a", "na", "none", "null", "undefined", "not applicable"]);

/** Values sellers or feeds leave in fields instead of leaving them empty. */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

/** Section headings that Amazon or sellers put inside description text. They aren't content. */
const FILLER = new Set([
  "product description",
  "from the manufacturer",
  "from the brand",
  "about this item",
  "about the product",
  "product details",
  "description",
  "image",
  "picture",
]);

export function isFiller(text: string): boolean {
  return FILLER.has(comparable(text));
}
