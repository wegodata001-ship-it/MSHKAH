import type { PriceRoundMode } from "@/lib/costing/types";

export function safeNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatIls(value: number, digits = 2): string {
  const n = Number.isFinite(value) ? value : 0;
  return `₪${n.toFixed(digits)}`;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function roundRecommendedPrice(price: number, mode: PriceRoundMode): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  switch (mode) {
    case "shekel":
      return Math.round(price);
    case "half":
      return Math.round(price * 2) / 2;
    case "ninety":
      return Math.floor(price) + 0.9;
    case "five":
      return Math.round(price / 5) * 5;
    default:
      return roundMoney(price, 2);
  }
}
