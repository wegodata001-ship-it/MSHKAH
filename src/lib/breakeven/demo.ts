import type { BreakEvenCatalogProduct, BreakEvenFixedCost, BreakEvenSettings, ProductCostLink } from "@/lib/breakeven/types";
import type { Order } from "@/types";

export type BreakEvenDemoScenario = "below" | "even" | "above";

const BASE_SALES = 28_000;
const ELAPSED_DAYS = 16;

type DishSeed = {
  id: string;
  price: number;
  quantity: number;
  names: { he: string; ar: string; en: string };
};

const DISHES: DishSeed[] = [
  { id: "demo-espresso", price: 12, quantity: 250, names: { he: "אספרסו", ar: "إسبريسو", en: "Espresso" } },
  { id: "demo-cappuccino", price: 16, quantity: 250, names: { he: "קפוצ'ינו", ar: "كابوتشينو", en: "Cappuccino" } },
  { id: "demo-latte", price: 18, quantity: 200, names: { he: "לאטה", ar: "لاتيه", en: "Latte" } },
  { id: "demo-croissant", price: 15, quantity: 200, names: { he: "קרואסון", ar: "كرواسون", en: "Croissant" } },
  { id: "demo-sandwich", price: 35, quantity: 120, names: { he: "כריך", ar: "ساندويتش", en: "Sandwich" } },
  { id: "demo-salad", price: 38, quantity: 100, names: { he: "סלט", ar: "سلطة", en: "Salad" } },
  { id: "demo-cake", price: 28, quantity: 100, names: { he: "עוגת גבינה", ar: "تشيز كيك", en: "Cheesecake" } },
  { id: "demo-juice", price: 18, quantity: 200, names: { he: "מיץ תפוזים", ar: "عصير برتقال", en: "Orange juice" } },
];

const EXTRA: Record<BreakEvenDemoScenario, { id: string; quantity: number }[]> = {
  below: [],
  even: [{ id: "demo-espresso", quantity: 1000 }],
  above: [
    { id: "demo-espresso", quantity: 1000 },
    { id: "demo-cappuccino", quantity: 500 },
  ],
};

const FIXED: { category: string; amount: number; names: { he: string; ar: string; en: string } }[] = [
  { category: "rent", amount: 8000, names: { he: "שכירות", ar: "إيجار", en: "Rent" } },
  { category: "salaries", amount: 12000, names: { he: "משכורות קבועות", ar: "رواتب ثابتة", en: "Fixed salaries" } },
  { category: "insurance", amount: 1000, names: { he: "ביטוחים", ar: "تأمين", en: "Insurance" } },
  { category: "software", amount: 500, names: { he: "תוכנות", ar: "برامج", en: "Software" } },
  { category: "accounting", amount: 1000, names: { he: "הנהלת חשבונות", ar: "محاسبة", en: "Accounting" } },
  { category: "other", amount: 1500, names: { he: "הוצאות קבועות אחרות", ar: "مصاريف ثابتة أخرى", en: "Other fixed costs" } },
];

function localeName(names: { he: string; ar: string; en: string }, locale: string): string {
  if (locale === "ar") return names.ar;
  if (locale === "en") return names.en;
  return names.he;
}

function splitCount(total: number, parts: number): number[] {
  const whole = Math.round(total);
  const base = Math.floor(whole / parts);
  let rest = whole - base * parts;
  return Array.from({ length: parts }, () => {
    const qty = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    return qty;
  });
}

function dayKey(index: number): string {
  return `2026-10-${String(index + 1).padStart(2, "0")}`;
}

export type DemoDish = {
  id: string;
  name: string;
  price: number;
  unitCost: number;
  quantity: number;
};

export function buildBreakEvenDemo(scenario: BreakEvenDemoScenario, locale = "he") {
  const quantities = new Map(DISHES.map((dish) => [dish.id, dish.quantity]));
  for (const extra of EXTRA[scenario]) quantities.set(extra.id, (quantities.get(extra.id) ?? 0) + extra.quantity);
  const dishes: DemoDish[] = DISHES.map((dish) => ({
    id: dish.id,
    name: localeName(dish.names, locale),
    price: dish.price,
    unitCost: dish.price * 0.4,
    quantity: quantities.get(dish.id) ?? 0,
  }));
  const stamp = "2026-10-01T00:00:00.000Z";
  const fixed: BreakEvenFixedCost[] = FIXED.map((item) => ({
    id: `demo-fixed-${item.category}`,
    name: localeName(item.names, locale),
    amount: item.amount,
    frequency: "monthly",
    category: item.category,
    vatMode: "before",
    vatRate: 0,
    active: true,
    createdAt: stamp,
    updatedAt: stamp,
    paymentFrequency: "monthly",
    billingDay: 1,
    billingStart: "2026-10-01",
    nextPaymentDate: "2026-10-01",
    paymentAccount: null,
  }));
  const settings: BreakEvenSettings = {
    operatingDays: 26,
    vatBasis: "before",
    vatRate: 0,
    alertGap: 500,
  };
  const products: BreakEvenCatalogProduct[] = dishes.map((dish) => ({ id: dish.id, name: dish.name, price: dish.price }));
  const links: ProductCostLink[] = dishes.map((dish) => ({
    id: `demo-link-${dish.id}`,
    productId: dish.id,
    kind: "estimate",
    estimateAmount: dish.unitCost,
    estimateNote: "demo",
    updatedAt: stamp,
  }));
  const dailyQty = new Map(dishes.map((dish) => [dish.id, splitCount(dish.quantity, ELAPSED_DAYS)]));
  const orders: Order[] = Array.from({ length: ELAPSED_DAYS }, (_, index) => {
    const day = dayKey(index);
    const items = dishes.map((dish) => ({
      productId: dish.id,
      productName: dish.name,
      quantity: dailyQty.get(dish.id)?.[index] ?? 0,
      price: dish.price,
    }));
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return {
      id: `demo-order-${scenario}-${day}`,
      orderNumber: `DEMO-${day}`,
      customerId: "demo",
      customerName: "demo",
      status: "delivered",
      items,
      total,
      paymentMethod: "cash",
      paymentStatus: "paid",
      paidAt: day,
      createdAt: `${day}T12:00:00`,
    };
  });
  return {
    scenario,
    settings,
    fixed,
    variable: [] as [],
    orders,
    products,
    links,
    dishes,
    from: "2026-10-01",
    to: "2026-10-31",
    now: new Date(2026, 9, 16, 12, 0, 0),
    baseSales: BASE_SALES,
  };
}
