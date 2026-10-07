import { normalizeIngredientName } from "@/lib/costing/names";

const MARKETING = new Set(
  [
    "مع",
    "و",
    "أو",
    "على",
    "في",
    "من",
    "إلى",
    "يقدم",
    "مقدم",
    "مقرمش",
    "ناعم",
    "الموسمية",
    "موسمية",
    "لذيذ",
    "طازج",
    "خاص",
    "served",
    "with",
    "and",
    "the",
    "a",
    "an",
    "fresh",
    "crispy",
    "soft",
    "seasonal",
    "delicious",
    "עם",
    "ו",
    "או",
    "מוגש",
    "פריך",
    "רך",
    "עונתי",
  ].map((word) => normalizeIngredientName(word))
);

/** Reserved for a future connected AI/import path. Not exposed in admin UI. */
export function suggestIngredientsFromMenuText(text: string): string[] {
  if (!text.trim()) return [];
  const parts = text.split(/[,،;|/]| - |\n| و | مع | with | and | עם /i);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const cleaned = part
      .replace(/[()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const key = normalizeIngredientName(cleaned);
    if (!key || key.length < 2 || MARKETING.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}
