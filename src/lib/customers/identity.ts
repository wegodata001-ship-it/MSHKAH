export type OrderIdentity = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  total?: number | null;
  createdAtMs?: number | null;
  productNames?: string[];
};

export type CustomerGroup = {
  key: string;
  name: string;
  phone: string;
  phoneKey: string;
  email: string;
  address: string;
  ordersCount: number;
  totalSpending: number;
  lastOrderMs: number | null;
  favoriteProducts: string[];
  orderIds: string[];
};

export const PICKUP_ADDRESS = "איסוף עצמי";

export function phoneKey(value: string | null | undefined): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  return digits;
}

export function nameKey(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isPlaceholderName(value: string | null | undefined): boolean {
  const key = nameKey(value);
  return key === "" || key === "guest" || key === "guest customer" || key === "אורח" || key === "زبون";
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? "";
}

function summarize(key: string, orders: OrderIdentity[]): CustomerGroup {
  const names = orders.map((order) => order.name.trim()).filter((name) => !isPlaceholderName(name));
  const phones = orders.map((order) => String(order.phone ?? "").trim()).filter((phone) => phoneKey(phone).length >= 9);
  const emails = orders
    .map((order) => String(order.email ?? "").trim().toLowerCase())
    .filter((email) => email.includes("@") && !email.endsWith("@mishkat.local"));
  const addresses = orders.map((order) => String(order.address ?? "").trim()).filter(Boolean);
  const productCounts = new Map<string, number>();
  for (const order of orders) {
    for (const product of order.productNames ?? []) {
      const label = product.trim();
      if (!label) continue;
      productCounts.set(label, (productCounts.get(label) ?? 0) + 1);
    }
  }
  const phone = mostCommon(phones);
  const lastOrderMs = orders.reduce<number | null>((latest, order) => {
    if (order.createdAtMs == null || !Number.isFinite(order.createdAtMs)) return latest;
    return latest == null || order.createdAtMs > latest ? order.createdAtMs : latest;
  }, null);
  const totalSpending = orders.reduce((sum, order) => {
    const total = Number(order.total);
    return Number.isFinite(total) ? sum + total : sum;
  }, 0);
  return {
    key,
    name: mostCommon(names) || phone || "לקוח",
    phone,
    phoneKey: phoneKey(phone),
    email: mostCommon(emails),
    address: addresses[0] || PICKUP_ADDRESS,
    ordersCount: orders.length,
    totalSpending: Math.round(totalSpending * 100) / 100,
    lastOrderMs,
    favoriteProducts: [...productCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label),
    orderIds: orders.map((order) => order.id),
  };
}

/**
 * People who typed the café's shared number stay separate by name.
 * A phone used by one or two names is treated as one person.
 * Placeholder names such as "Guest Customer" never become a customer.
 */
export function groupOrderIdentities(orders: OrderIdentity[]): CustomerGroup[] {
  const namesByPhone = new Map<string, Set<string>>();
  for (const order of orders) {
    const phone = phoneKey(order.phone);
    const name = nameKey(order.name);
    if (phone.length < 9 || !name || isPlaceholderName(order.name)) continue;
    const names = namesByPhone.get(phone) ?? new Set<string>();
    names.add(name);
    namesByPhone.set(phone, names);
  }

  const groups = new Map<string, OrderIdentity[]>();
  for (const order of orders) {
    if (isPlaceholderName(order.name)) continue;
    const phone = phoneKey(order.phone);
    const name = nameKey(order.name);
    const shared = (namesByPhone.get(phone)?.size ?? 0) > 2;
    const key = phone.length >= 9 && !shared ? `phone:${phone}` : `name:${name}`;
    const list = groups.get(key) ?? [];
    list.push(order);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([key, list]) => summarize(key, list));
}

export function matchExistingCustomer(
  group: CustomerGroup,
  existing: Array<{ id: string; name?: string | null; phone?: string | null }>,
  usedIds: Set<string>
): string | null {
  const candidates = existing.filter((customer) => customer.id !== "guest-checkout" && !usedIds.has(customer.id) && !isPlaceholderName(customer.name));
  if (group.phoneKey.length >= 9) {
    const byPhone = candidates.find((customer) => phoneKey(customer.phone) === group.phoneKey);
    if (byPhone) return byPhone.id;
  }
  const byName = candidates.find((customer) => nameKey(customer.name) === nameKey(group.name));
  return byName?.id ?? null;
}
