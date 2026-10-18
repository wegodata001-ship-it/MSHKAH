import { aliasOverlap } from "@/lib/costing/ingredient-aliases";
import type { CostingIngredient } from "@/lib/costing/types";
import { mergeCategoryNames } from "@/lib/inventory/category-name";

export const MATCH_SUGGEST_MIN = 0.6;
export const MATCH_SAFE_MIN = 0.9;
export const MATCH_TOP_N = 3;

const MEASURE = new Set([
  "kg", "g", "gr", "gram", "grams", "l", "lt", "liter", "ml",
  "קג", "ק״ג", 'ק"ג', "גרם", "גר", "ליטר", "מל",
  "كجم", "كيلو", "غرام", "لتر",
  "unit", "pcs", "pc", "יח", "יחידה",
]);

export type ProductMatchCandidate = {
  productId: string;
  name: string;
  score: number;
};

export function normalizeMatchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[״"׳']/g, "")
    .replace(/[^\p{L}\p{N}\s./x×-]/gu, " ")
    .replace(/(\d)\s*(kg|g|gr|l|ml|קג|גרם|ליטר|מל)\b/giu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchTokens(value: string): string[] {
  const normalized = normalizeMatchText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function isMeasureToken(token: string): boolean {
  if (MEASURE.has(token)) return true;
  return /^\d+([./]\d+)?(kg|g|gr|l|ml|קג|גרם|ליטר|מל)?$/i.test(token);
}

function coreTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !isMeasureToken(token));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let left = i;
    for (let j = 1; j <= b.length; j++) {
      const insert = prev[j] + 1;
      const del = left + 1;
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const next = Math.min(insert, del, sub);
      prev[j - 1] = left;
      left = next;
    }
    prev[b.length] = left;
  }
  return prev[b.length];
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.max(a.length, b.length) === 0 ? 0 : Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export function productNameSimilarity(invoiceName: string, inventoryName: string): number {
  const left = normalizeMatchText(invoiceName);
  const right = normalizeMatchText(inventoryName);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = matchTokens(left);
  const rightTokens = matchTokens(right);
  const leftCore = coreTokens(leftTokens);
  const rightCore = coreTokens(rightTokens);
  if (!leftCore.length || !rightCore.length) return 0;

  if (leftCore.join(" ") === rightCore.join(" ")) return 0.96;

  const smaller = leftCore.length <= rightCore.length ? leftCore : rightCore;
  const larger = leftCore.length <= rightCore.length ? rightCore : leftCore;
  const contained = smaller.every((token) => larger.some((item) => tokenSimilarity(token, item) >= 0.82));
  if (contained && smaller.length >= 1) {
    const extra = Math.max(0, larger.length - smaller.length);
    return Math.max(0.78, 0.97 - extra * 0.03);
  }

  const scores = leftCore.map((token) => Math.max(...rightCore.map((item) => tokenSimilarity(token, item))));
  const tokenAvg = scores.reduce((sum, n) => sum + n, 0) / scores.length;
  const alias = aliasOverlap(invoiceName, inventoryName);
  const charDist = levenshtein(leftCore.join(" "), rightCore.join(" "));
  const charScore = 1 - charDist / Math.max(leftCore.join(" ").length, rightCore.join(" ").length);
  return Math.max(tokenAvg * 0.72 + charScore * 0.18 + alias * 0.1, alias, contained ? 0.78 : 0);
}

export function rankProductMatches(
  invoiceName: string,
  ingredients: CostingIngredient[],
  limit = MATCH_TOP_N,
  minScore = MATCH_SUGGEST_MIN
): ProductMatchCandidate[] {
  return ingredients
    .filter((item) => item.active !== false)
    .map((item) => ({
      productId: item.id,
      name: item.name,
      score: productNameSimilarity(invoiceName, item.name),
    }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function inventoryCategories(
  ingredients: CostingIngredient[],
  extras: Array<string | null | undefined> = []
): string[] {
  return mergeCategoryNames(extras, ingredients.map((item) => item.category));
}

export function isSafeInvoiceMatch(score: number | null | undefined, kind?: string): boolean {
  if (kind === "exact" || kind === "mapped") return true;
  return (score ?? 0) >= MATCH_SAFE_MIN;
}
