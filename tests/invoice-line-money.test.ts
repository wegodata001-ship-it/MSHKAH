import { describe, expect, it } from "vitest";
import { emptyInvoiceLine, finalizeInvoiceLine, invoiceTableTotals } from "@/lib/inventory/invoice-lines";
import { applyInvoiceLineMoney, shownLinePrices } from "@/lib/inventory/unit-price";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

function line(patch: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return { ...emptyInvoiceLine(0.18), rawName: "מוצר", ...patch };
}

describe("invoice line totals", () => {
  it("recalculates the line total from quantity and unit price", () => {
    const next = applyInvoiceLineMoney(line({ quantity: 15, vatType: "unknown", taxMode: "unknown" }), { field: "unitPrice", unitPrice: 106 }, 0.18);
    expect(next.unitPrice).toBe(106);
    expect(next.lineTotal).toBe(1590);
    const more = applyInvoiceLineMoney(line({ ...next, vatType: "unknown", taxMode: "unknown" }), { field: "quantity", quantity: 16 }, 0.18);
    expect(more.unitPrice).toBe(106);
    expect(more.lineTotal).toBe(1696);
  });

  it("derives the unit price from the line total once", () => {
    const next = applyInvoiceLineMoney(line({ quantity: 2 }), { field: "lineTotal", lineTotal: 6 }, 0.18);
    expect(next.unitPrice).toBe(3);
    expect(next.unitPriceIncludingVat).toBe(3);
    expect(next.unitPriceExcludingVat).toBe(2.54);
    expect(next.lineTotalIncludingVat).toBe(6);
    expect(next.lineTotalExcludingVat).toBe(5.08);
    expect(next.vatAmount).toBe(0.92);
    expect(next.unitPrice).not.toBe(1.5);
  });

  it("keeps an excluding price and adds VAT once", () => {
    const next = applyInvoiceLineMoney(
      line({ quantity: 4, vatType: "exclusive", taxMode: "exclusive", priceIncludesVat: false }),
      { field: "unitPrice", unitPrice: 8 },
      0.18
    );
    expect(next.lineTotalExcludingVat).toBe(32);
    expect(next.lineTotalIncludingVat).toBe(37.76);
    expect(next.unitPriceIncludingVat).toBe(9.44);
  });

  it("keeps an exempt price unchanged", () => {
    const next = applyInvoiceLineMoney(
      line({ quantity: 2, vatType: "exempt", taxMode: "exempt" }),
      { field: "unitPrice", unitPrice: 10 },
      0.18
    );
    expect(next.unitPriceExcludingVat).toBe(10);
    expect(next.unitPriceIncludingVat).toBe(10);
    expect(next.lineTotal).toBe(20);
    expect(next.vatAmount).toBe(0);
  });

  it("rounds a decimal quantity without a second division", () => {
    const next = applyInvoiceLineMoney(
      line({ vatType: "exclusive", taxMode: "exclusive", priceIncludesVat: false }),
      { field: "unitPrice", unitPrice: 1.89 },
      0.18
    );
    const withQty = applyInvoiceLineMoney(line({ ...next }), { field: "quantity", quantity: 12.7 }, 0.18);
    expect(withQty.lineTotalExcludingVat).toBe(24);
    const fromTotal = applyInvoiceLineMoney(
      line({ quantity: 12.7, vatType: "exclusive", taxMode: "exclusive", priceIncludesVat: false }),
      { field: "lineTotal", lineTotal: 24 },
      0.18
    );
    expect(fromTotal.unitPrice).toBe(1.89);
  });

  it("applies a line discount before the line total", () => {
    const priced = applyInvoiceLineMoney(
      line({ quantity: 2, vatType: "exempt", taxMode: "exempt" }),
      { field: "unitPrice", unitPrice: 10 },
      0
    );
    const discounted = applyInvoiceLineMoney(line({ ...priced }), { field: "discount", discount: 4 }, 0);
    expect(discounted.unitPrice).toBe(10);
    expect(discounted.lineTotal).toBe(16);
  });

  it("survives save and reload", () => {
    const patch = applyInvoiceLineMoney(line({ quantity: 2 }), { field: "lineTotal", lineTotal: 6 }, 0.18);
    const saved = finalizeInvoiceLine(line({ ...patch }), 0.18);
    const reloaded = JSON.parse(JSON.stringify(saved)) as PurchaseInvoiceLine;
    expect(reloaded.quantity).toBe(2);
    expect(reloaded.unitPrice).toBe(3);
    expect(reloaded.unitPriceExcludingVat).toBe(2.54);
    expect(reloaded.lineTotalIncludingVat).toBe(6);
    expect(reloaded.vatRate).toBe(0.18);
    expect(reloaded.priceIncludesVat).toBe(true);
    expect(reloaded.originalLineTotal).toBe(null);
  });

  it("shows the scanned unit and line together for the sample rows", () => {
    const rows = [
      ["טורט 24", 15, 106, 1590],
      ["עוגיות ללא סוכר", 4, 30, 120],
      ["עוגיות", 8, 28, 224],
      ["קונטיסה", 2, 30, 60],
    ] as const;
    const lines = rows.map(([name, quantity, unitPrice, lineTotal]) => line({
      rawName: name,
      quantity,
      unitPrice,
      lineTotal,
      lineNet: lineTotal,
      lineGross: Math.round(lineTotal * 1.18 * 100) / 100,
      priceBeforeVat: lineTotal,
      unitPriceNet: unitPrice,
      vatAmount: Math.round(lineTotal * 0.18 * 100) / 100,
      vatType: "exclusive",
      taxMode: "exclusive",
      priceIncludesVat: false,
    }));
    for (const [name, , unitPrice, lineTotal] of rows) {
      const shown = shownLinePrices(lines.find((item) => item.rawName === name)!);
      expect(shown.unit).toBe(unitPrice);
      expect(shown.line).toBe(lineTotal);
    }
    const totals = invoiceTableTotals(lines);
    expect(totals.net).toBe(1994);
    expect(totals.gross).toBe(2352.92);
  });
});
