import { roundMoney } from "@/lib/costing/money";
import type { FoodCostVatMode, VatType } from "@/lib/inventory/types";

export const DEFAULT_VAT_RATE = 0.18;

export function normalizeVatRate(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return DEFAULT_VAT_RATE;
  return rate > 1 ? rate / 100 : rate;
}

export function splitVat(input: {
  amount: number;
  vatType: VatType;
  vatRate: number;
}): { priceBeforeVat: number; vatAmount: number; priceIncludingVat: number } {
  const amount = Number.isFinite(input.amount) ? input.amount : 0;
  const rate = normalizeVatRate(input.vatRate);
  if (input.vatType === "exempt" || rate <= 0) {
    return { priceBeforeVat: roundMoney(amount), vatAmount: 0, priceIncludingVat: roundMoney(amount) };
  }
  if (input.vatType === "inclusive") {
    const before = amount / (1 + rate);
    return {
      priceBeforeVat: roundMoney(before),
      vatAmount: roundMoney(amount - before),
      priceIncludingVat: roundMoney(amount),
    };
  }
  return {
    priceBeforeVat: roundMoney(amount),
    vatAmount: roundMoney(amount * rate),
    priceIncludingVat: roundMoney(amount * (1 + rate)),
  };
}

export function foodCostAmount(
  priceBeforeVat: number,
  priceIncludingVat: number,
  mode: FoodCostVatMode
): number {
  return mode === "including" ? priceIncludingVat : priceBeforeVat;
}
