import { describe, expect, it } from "vitest";
import { invoiceMoneyCheck } from "@/lib/inventory/invoice-finance";
import { applyComputedTotals, canApproveInvoice, invoiceApproveBlockers, readyProductLineCount } from "@/lib/inventory/invoice-intake";
import { invoiceLineBlockers, invoiceLineReviewStatus } from "@/lib/inventory/invoice-line-status";
import { emptyInvoiceLine, invoiceFinanceTotals } from "@/lib/inventory/invoice-lines";
import { invoicePurchaseMovementId, selectStockPostLines } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

function row(patch: Partial<PurchaseInvoiceLine> & Pick<PurchaseInvoiceLine, "rawName">): PurchaseInvoiceLine {
  return {
    ...emptyInvoiceLine(0.18),
    quantity: 1,
    unit: "unit",
    vatType: "exclusive",
    matchKind: "exact",
    matchConfirmed: true,
    productId: `p-${patch.rawName}`,
    ...patch,
  };
}

function doc(lines: PurchaseInvoiceLine[], patch: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "doc",
    supplierName: "ג. ג. מוצרי אריזות (2009) בע\"מ",
    invoiceNumber: patch.invoiceNumber ?? "100",
    invoiceDate: "2026-10-15",
    receivedAt: "2026-10-15",
    status: "draft",
    lines,
    createdAt: "2026-10-15T00:00:00.000Z",
    ...patch,
  };
}

describe("invoice intake gate", () => {
  it("compares invoice 221496 on the net basis and does not count the VAT gap as a missing line", () => {
    const lines = [
      row({ rawName: "מגש", quantity: 4, unit: "unit", unitPrice: 50, lineNet: 200, lineGross: 200, netAmount: 200, grossAmount: 200 }),
      row({ rawName: "מכסה", quantity: 2, unit: "kg", unitPrice: 141, lineNet: 282, lineGross: 282, netAmount: 282, grossAmount: 282 }),
    ];
    const header = {
      sourceNet: 482.2,
      netAmount: 482.2,
      sourceVat: 86.8,
      vatAmount: 86.8,
      sourceGross: 569,
      grossAmount: 569,
    };
    const first = doc(lines, { invoiceNumber: "221496", ...header });
    const other = doc(lines, { invoiceNumber: "88421", id: "other", ...header });
    for (const invoice of [first, other]) {
      const money = invoiceMoneyCheck(invoice);
      expect(money.basis).toBe("net");
      expect(money.difference).toBeCloseTo(-0.2, 2);
      expect(Math.abs(money.difference ?? 0)).not.toBeCloseTo(87, 2);
      expect(invoiceLineBlockers(invoice.lines)).toHaveLength(0);
      expect(invoiceApproveBlockers(invoice).map((item) => item.key)).not.toContain("amounts");
      expect(canApproveInvoice(invoice)).toBe(false);
      expect(canApproveInvoice({ ...invoice, moneyGapAccepted: true })).toBe(true);
      expect(applyComputedTotals(invoice).lines).toHaveLength(lines.length);
      expect(applyComputedTotals(invoice).differenceAmount).toBeCloseTo(-0.2, 2);
    }
  });

  it("keeps an adjustment sign and closes the gap without inventing a product", () => {
    const lines = [
      row({ rawName: "מגש", unitPrice: 482, lineNet: 482, lineGross: 482, netAmount: 482, grossAmount: 482 }),
      row({
        rawName: "עיגול",
        lineType: "DISCOUNT",
        productId: undefined,
        matchConfirmed: false,
        unitPrice: 0.2,
        lineNet: 0.2,
        lineGross: 0.2,
        netAmount: 0.2,
        grossAmount: 0.2,
      }),
    ];
    const invoice = doc(lines, { sourceNet: 482.2, netAmount: 482.2, sourceVat: 86.8, vatAmount: 86.8, sourceGross: 569, grossAmount: 569 });
    expect(invoiceFinanceTotals(lines).net).toBeCloseTo(482.2, 2);
    expect(invoiceMoneyCheck(invoice).hasMismatch).toBe(false);
    expect(invoiceLineBlockers(invoice.lines)).toHaveLength(0);
    expect(readyProductLineCount(invoice.lines)).toBe(1);
    expect(selectStockPostLines(invoice).map((line) => line.rawName)).toEqual(["מגש"]);

    const negative = doc(
      [
        row({ rawName: "מגש", unitPrice: 482, lineNet: 482, lineGross: 482, netAmount: 482, grossAmount: 482 }),
        row({ rawName: "התאמה", productId: undefined, matchConfirmed: false, unitPrice: 0.2, lineNet: -0.2, lineGross: -0.2, netAmount: -0.2, grossAmount: -0.2 }),
      ],
      { sourceNet: 481.8, netAmount: 481.8, sourceGross: 481.8, grossAmount: 481.8, sourceVat: 0, vatAmount: 0 }
    );
    expect(invoiceMoneyCheck(negative).difference).toBeCloseTo(0, 2);
  });

  it("matches VAT-inclusive lines to the payable total and exempt lines to the net total", () => {
    const inclusive = doc(
      [row({ rawName: "קפה", unit: "kg", unitPrice: 100, lineNet: 100, lineGross: 118, netAmount: 100, grossAmount: 118, vatAmount: 18 })],
      { sourceNet: 100, netAmount: 100, sourceVat: 18, vatAmount: 18, sourceGross: 118, grossAmount: 118 }
    );
    expect(invoiceMoneyCheck(inclusive)).toMatchObject({ basis: "gross", difference: 0, hasMismatch: false });
    expect(canApproveInvoice(inclusive)).toBe(true);

    const exempt = doc(
      [row({ rawName: "סוכר", unit: "g", unitPrice: 50, lineNet: 50, lineGross: 50, netAmount: 50, grossAmount: 50, vatType: "exempt", vatAmount: 0 })],
      { sourceNet: 50, netAmount: 50, sourceVat: 0, vatAmount: 0, sourceGross: 50, grossAmount: 50, vatRate: 0 }
    );
    expect(invoiceMoneyCheck(exempt).hasMismatch).toBe(false);
    expect(canApproveInvoice(exempt)).toBe(true);
  });

  it("subtracts a discount and still reports a real gross gap separately from line readiness", () => {
    const lines = [
      row({ rawName: "קמח", unit: "kg", unitPrice: 100, lineNet: 100, lineGross: 118, netAmount: 100, grossAmount: 118, vatAmount: 18 }),
      row({
        rawName: "הנחה",
        lineType: "DISCOUNT",
        productId: undefined,
        matchConfirmed: false,
        unitPrice: 10,
        lineNet: 10,
        lineGross: 11.8,
        netAmount: 10,
        grossAmount: 11.8,
        vatAmount: 1.8,
      }),
    ];
    const matched = doc(lines, { sourceNet: 90, netAmount: 90, sourceVat: 16.2, vatAmount: 16.2, sourceGross: 106.2, grossAmount: 106.2 });
    expect(invoiceFinanceTotals(lines).gross).toBeCloseTo(106.2, 2);
    expect(invoiceMoneyCheck(matched).hasMismatch).toBe(false);
    expect(invoiceLineBlockers(matched.lines)).toHaveLength(0);

    const short = doc(lines, { sourceNet: 90, netAmount: 90, sourceVat: 16.2, vatAmount: 16.2, sourceGross: 100, grossAmount: 100 });
    const money = invoiceMoneyCheck(short);
    expect(money.basis).toBe("gross");
    expect(money.difference).toBeCloseTo(6.2, 2);
    expect(invoiceLineBlockers(short.lines)).toHaveLength(0);
    expect(invoiceApproveBlockers(short)).toHaveLength(0);
    expect(canApproveInvoice(short)).toBe(false);
    expect(canApproveInvoice({ ...short, moneyGapAccepted: true })).toBe(true);
  });

  it("names the missing line, clears it after the field is filled, and ignores a VAT row", () => {
    const missing = row({ rawName: "חלב", unit: "", productId: "milk", matchKind: "exact", matchConfirmed: true, unitPrice: 8, lineNet: 8, lineGross: 8 });
    const vat = row({ rawName: "מע\"מ", productId: undefined, matchConfirmed: false, unit: "", quantity: 0, unitPrice: undefined, lineNet: 86.8, lineGross: 86.8 });
    const open = doc([missing, vat], { sourceNet: 8, grossAmount: 8, sourceGross: 8 });
    const blockers = invoiceLineBlockers(open.lines);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ lineIndex: 1, kind: "missing-unit" });
    expect(invoiceLineReviewStatus(vat).kind).toBe("ancillary");
    expect(selectStockPostLines(open)).toHaveLength(0);

    const fixed = { ...missing, unit: "liter" };
    const closed = doc([fixed, vat], { sourceNet: 8, netAmount: 8, sourceGross: 8, grossAmount: 8, sourceVat: 0, vatAmount: 0 });
    expect(invoiceLineBlockers(closed.lines)).toHaveLength(0);
    expect(readyProductLineCount(closed.lines)).toBe(1);
    expect(canApproveInvoice(closed)).toBe(true);
    expect(selectStockPostLines(closed)).toHaveLength(1);
    expect(selectStockPostLines({ ...closed, lines: closed.lines.map((line) => ({ ...line, postedToStock: true })) })).toHaveLength(0);
    expect(invoicePurchaseMovementId("doc", fixed.key)).toBe(invoicePurchaseMovementId("doc", fixed.key));
  });

  it("does not treat a new unmatched product name as incomplete and blocks a blank product", () => {
    const created = row({ rawName: "חומר חדש", productId: undefined, matchKind: "suggest", matchConfirmed: false, unit: "unit", unitPrice: 12, lineNet: 12, lineGross: 12 });
    const blank = row({ rawName: "", originalDescription: "", productId: undefined, matchKind: "none", matchConfirmed: false, unit: "unit", unitPrice: 12, lineNet: 12, lineGross: 12 });
    expect(invoiceLineReviewStatus(created).kind).toBe("ready");
    expect(invoiceLineBlockers(doc([created]).lines)).toHaveLength(0);
    expect(invoiceLineBlockers(doc([blank]).lines)[0]?.kind).toBe("missing-material");
  });
});
