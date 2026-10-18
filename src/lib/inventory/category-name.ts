export function normalizeCategoryName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u05B0-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C7]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[״"׳']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function categoryDocId(normalized: string): string {
  const slug = normalized.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `ic-${slug || "cat"}`.replace(/[\/\\#?[\]*]/g, "_");
}

export function findCategoryByNormalizedName(name: string, existing: string[]): string | undefined {
  const target = normalizeCategoryName(name);
  if (!target) return undefined;
  return existing.find((item) => normalizeCategoryName(item) === target);
}

export function mergeCategoryNames(...groups: Array<Iterable<string | null | undefined>>): string[] {
  const names = new Map<string, string>();
  for (const group of groups) {
    for (const value of group) {
      const name = String(value ?? "").trim();
      if (!name) continue;
      const key = normalizeCategoryName(name);
      if (!key || names.has(key)) continue;
      names.set(key, name);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, "he"));
}
