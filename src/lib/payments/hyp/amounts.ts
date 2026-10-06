/** Format the authoritative order total for Hyp Pay Amount (up to 2 decimal digits). */
export function formatHypAmount(total: number): string {
  if (!Number.isFinite(total)) return "";
  return (Math.round(total * 100) / 100).toFixed(2);
}

export function parseHypAmount(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export function amountsMatch(expected: number, returned: string | number): boolean {
  const actual = parseHypAmount(returned);
  if (actual == null) return false;
  return Math.abs(expected - actual) < 0.009;
}

function money(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Sum stored lines. Ignores a manipulated `total` field. */
export function amountFromOrderItems(order: {
  items?: Array<{ price?: unknown; quantity?: unknown }>;
  discount?: unknown;
  delivery?: unknown;
}): number {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsSum = items.reduce((sum, item) => {
    const qty = money(item.quantity);
    if (qty <= 0) return sum;
    return sum + money(item.price) * qty;
  }, 0);
  const discount = Math.max(0, money(order.discount));
  const delivery = Math.max(0, money(order.delivery));
  return Math.max(Math.round((itemsSum - discount + delivery) * 100) / 100, 0);
}

/**
 * Never trust a client-supplied checkout total.
 * Prefer the sum of stored line items; fall back to order.total only if lines are empty.
 */
export function authoritativeOrderAmount(order: {
  total?: unknown;
  items?: Array<{ price?: unknown; quantity?: unknown }>;
  discount?: unknown;
  delivery?: unknown;
}): number {
  const fromItems = amountFromOrderItems(order);
  if (fromItems > 0) return fromItems;
  return money(order.total);
}
