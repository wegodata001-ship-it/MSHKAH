import { normalizeIngredientName } from "@/lib/costing/names";

const GROUPS: string[][] = [
  ["pasta", "spaghetti", "macaroni", "penne", "fettuccine", "פסטה", "ספגטי", "מקרוני", "פנה", "باستا", "معكرونة", "سباغيتي"],
  ["cream", "cooking cream", "heavy cream", "שמנת", "קרם", "كريمة", "كريمه", "قشطة"],
  ["mushroom", "mushrooms", "פטריות", "פטריה", "فطر", "فطر"],
  ["parmesan", "parmigiano", "פרמזן", "פרמז'ן", "بارميزان"],
  ["mozzarella", "מוצרלה", "מוצרלה", "موزاريلا", "موتزاريلا"],
  ["milk", "חלב", "حليب"],
  ["sugar", "סוכר", "سكر"],
  ["coffee", "קפה", "قهوة"],
  ["cheese", "גבינה", "جبنة", "جبنه"],
  ["butter", "חמאה", "زبدة", "زبده"],
  ["egg", "eggs", "ביצה", "ביצים", "بيض"],
  ["flour", "קמח", "طحين", "دقيق"],
  ["tomato", "tomatoes", "עגבניה", "עגבניות", "بندورة", "طماطم"],
  ["onion", "onions", "בצל", "بصل"],
  ["garlic", "שום", "ثوم"],
  ["olive oil", "שמן זית", "زيت زيتون"],
  ["oil", "שמן", "زيت"],
  ["salt", "מלח", "ملح"],
  ["pepper", "פלפל", "فلفل"],
  ["chicken", "עוף", "دجاج"],
  ["beef", "בקר", "لحم بقر"],
  ["salmon", "סלמון", "سلمون"],
  ["tuna", "טונה", "تونة", "تونه"],
  ["avocado", "אבוקדו", "أفوكادو"],
  ["basil", "ריחן", "ريحان"],
  ["pesto", "פסטו", "بيستو"],
  ["bread", "לחם", "خبز"],
  ["lettuce", "חסה", "خس"],
  ["pickle", "מלפפון חמוץ", "خيار مخلل"],
];

const ALIAS_TO_GROUP = new Map<string, number>();
GROUPS.forEach((group, index) => {
  for (const alias of group) {
    ALIAS_TO_GROUP.set(normalizeIngredientName(alias), index);
  }
});

export function aliasTokens(name: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = normalizeIngredientName(name);
  if (!normalized) return tokens;
  tokens.add(normalized);
  for (const [alias, index] of ALIAS_TO_GROUP) {
    if (normalized === alias || normalized.includes(alias) || alias.includes(normalized)) {
      for (const item of GROUPS[index]) tokens.add(normalizeIngredientName(item));
    }
  }
  return tokens;
}

export function aliasOverlap(a: string, b: string): number {
  const left = aliasTokens(a);
  const right = aliasTokens(b);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) {
    if (right.has(token)) hits += 1;
  }
  if (!hits) return 0;
  const exact = left.has(normalizeIngredientName(b)) || right.has(normalizeIngredientName(a));
  return exact ? 0.96 : Math.min(0.94, 0.72 + hits * 0.04);
}
