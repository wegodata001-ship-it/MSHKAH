export type PosSummaryMetric = "items" | "quantity" | "revenue" | "cost" | "profit" | "generic";

const TOTAL_PREFIX = /^(סהכ|סיכום|total|grand_total|grand total|مجموع|الاجمالي|الإجمالي)(?:\s+|$)/i;

const METRIC_START: { metric: Exclude<PosSummaryMetric, "generic">; pattern: RegExp }[] = [
  { metric: "items", pattern: /^(פריטים|פריט|items?|item_count|عدد_?الأصناف|الاصناف|الأصناف)/i },
  { metric: "quantity", pattern: /^(כמות(?:\s+(?:נמכרה|מכירה|שנמכרה))?|qty|quantity(?:\s+sold)?|كمية(?:\s+المبيعات)?)/i },
  { metric: "revenue", pattern: /^(הכנסות|מכירות|revenue|sales|إيرادات|ايرادات|المبيعات)/i },
  { metric: "cost", pattern: /^(עלויות|עלות|costs?|تكلفة|تكاليف)/i },
  { metric: "profit", pattern: /^(רווח|profit|ربح)/i },
];

export function normalizePosLabel(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[״"'`׳]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function classifyPosSummaryMetric(name: unknown): PosSummaryMetric | null {
  const label = normalizePosLabel(name).replace(/^סה\s+כ(?=\s|$)/, "סהכ");
  if (!label) return null;
  const compact = label.replace(/\s+/g, "_");
  const prefixed = label.match(TOTAL_PREFIX) || compact.match(/^(סהכ|סיכום|total|grand_total|مجموع|الاجمالي|الإجمالي)(?:_|$)/);
  if (!prefixed) return null;
  const rest = label.slice(prefixed[0].length).trim();
  if (!rest) return "generic";
  for (const item of METRIC_START) {
    if (item.pattern.test(rest) || item.pattern.test(rest.replace(/\s+/g, "_"))) return item.metric;
  }
  return null;
}

export function isPosSummaryMetricLabel(name: unknown): boolean {
  return classifyPosSummaryMetric(name) != null;
}

export function findTrailingSummaryFooter<T>(
  rows: T[],
  nameOf: (row: T) => string,
  isBlank?: (row: T) => boolean
): { start: number; rows: T[] } | null {
  let end = rows.length - 1;
  while (end >= 0 && (isBlank?.(rows[end]) || !nameOf(rows[end]).trim())) end -= 1;
  if (end < 0) return null;
  let start = end;
  while (start >= 0) {
    const name = nameOf(rows[start]);
    if (isBlank?.(rows[start]) || !name.trim()) {
      start -= 1;
      continue;
    }
    if (!isPosSummaryMetricLabel(name)) break;
    start -= 1;
  }
  start += 1;
  while (start <= end && (isBlank?.(rows[start]) || !nameOf(rows[start]).trim())) start += 1;
  const footer = rows.slice(start, end + 1).filter((row) => isPosSummaryMetricLabel(nameOf(row)));
  return footer.length ? { start, rows: footer } : null;
}
