import { describe, expect, it } from "vitest";
import type { CostingIngredient } from "@/lib/costing/types";
import {
  canonicalPurchaseName,
  inferPurchasePack,
  isWritablePurchaseRow,
  parsePurchaseMarkdown,
  planPurchaseList,
  purchaseInvoiceDuplicate,
  unifySupplierName,
} from "@/lib/inventory/purchase-list";
import type { PurchaseInvoice, Supplier } from "@/lib/inventory/types";

const SAMPLE = `
| מוצר | כמות | סכום לפני מע״מ |
| --- | --- | --- |
| פאן סוויס קפוא | 4 | 200 |
| נוטלה 3 ק״ג | 2 | 180 |
| קולה 24 פחיות | 1 | 48 |
| מגש ביצים 30 | 2 | 40 |
| מים XL | 3 | 21 |

| ספק | חשבונית | תאריך | מוצר | כמות | יחידה | מחיר | לפני מע״מ | מע״מ | כולל מע״מ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| אלסונבולה שיווק מוצרי מזון בע״מ | 10226 | 03/09/2026 | פאן סוויס קפוא | 2 | מגש | 50 | 100 | 18 | 118 |
| אלסונבולה שיווק מוצרי מזון בע״מ | 10252 | 18/09/2026 | פאן סוויס קפוא | 2 | מגש | 52 | 104 | 18.72 | 122.72 |
| אלסונבולה | 10226 | 03/09/2026 | נוטלה 3 ק״ג | 2 | דלי | 90 | 180 | 32.4 | 212.4 |
| בריוש | 881 | 10/09/2026 | קולה 24 פחיות | 1 | ארגז | 48 | 48 | 8.64 | 56.64 |
| בריוש | 881 | 10/09/2026 | מגש ביצים של 30 | 2 | מגש | 20 | 40 | 7.2 | 47.2 |
| בריוש | 881 | 10/09/2026 | מים XL | 3 | יח | 7 | 21 | 3.78 | 24.78 |
`;

const emptyIngredient: CostingIngredient = {
  id: "pan-existing",
  name: "פאן סוויס קפוא",
  purchasePrice: 40,
  purchaseQuantity: 1,
  purchaseUnit: "unit",
  baseUnit: "unit",
  costPerBaseUnit: 40,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const alsunbola: Supplier = {
  id: "sup-alsunbola",
  name: "אלסונבולה שיווק מוצרי מזון בע״מ",
  active: true,
  createdAt: "",
  updatedAt: "",
};

describe("purchase list parse", () => {
  it("uses the detailed invoice table as the purchase source", () => {
    const parsed = parsePurchaseMarkdown(SAMPLE);
    expect(parsed.detail).toHaveLength(6);
    expect(parsed.summary).toHaveLength(5);
    expect(parsed.detail.every((line) => line.invoiceNumber)).toBe(true);
    expect(parsed.detail.filter((line) => line.canonicalName === "פאן סוויס קפוא")).toHaveLength(2);
    expect(parsed.detail.map((line) => line.invoiceNumber).sort()).toEqual(["10226", "10226", "10252", "881", "881", "881"].sort());
  });

  it("keeps the same product across invoices as one canonical name", () => {
    expect(canonicalPurchaseName("פאן סוויס קפוא חשבונית 10226")).toBe("פאן סוויס קפוא");
    const parsed = parsePurchaseMarkdown(SAMPLE);
    const names = [...new Set(parsed.detail.map((line) => line.canonicalName))];
    expect(names).toContain("פאן סוויס קפוא");
    expect(names.some((name) => /10226|10252/.test(name))).toBe(false);
  });
});

describe("purchase conversions", () => {
  it("converts stated pack sizes and leaves vague rows for review", () => {
    const nutella = inferPurchasePack("נוטלה 3 ק״ג", 2, "דלי");
    expect(nutella.stockQuantity).toBe(6);
    expect(nutella.purchaseUnit).toBe("kg");
    expect(nutella.needsReview).toBe(false);

    const cola = inferPurchasePack("קולה 24 פחיות", 1, "ארגז");
    expect(cola.stockQuantity).toBe(24);
    expect(cola.needsReview).toBe(false);

    const eggs = inferPurchasePack("מגש ביצים של 30", 2, "מגש");
    expect(eggs.stockQuantity).toBe(60);
    expect(eggs.needsReview).toBe(false);

    const water = inferPurchasePack("מים XL", 3, "יח");
    expect(water.packSize).toBeNull();
    expect(water.needsReview).toBe(true);
  });
});

describe("purchase list plan", () => {
  it("unifies suppliers, matches an existing material, and does not treat summary rows as purchases", () => {
    const plan = planPurchaseList({
      text: SAMPLE,
      ingredients: [emptyIngredient],
      suppliers: [alsunbola],
    });
    expect(plan.detailLines).toHaveLength(6);
    expect(plan.summaryLines).toHaveLength(5);
    expect(plan.purchaseCount).toBe(6);
    expect(unifySupplierName("אלסונבולה")).toBe("אלסונבולה שיווק מוצרי מזון בע״מ");
    expect(plan.createSupplierNames).toEqual(["בריוש"]);
    expect(plan.rows.filter((row) => row.canonicalName === "פאן סוויס קפוא").every((row) => row.identity === "existing")).toBe(true);
    expect(plan.createIngredientCount).toBe(4);
    expect(plan.rows.find((row) => row.sourceName.includes("מים"))?.needs).toContain("conversion");
  });

  it("does not merge a fuzzy name without approval", () => {
    const plan = planPurchaseList({
      text: SAMPLE,
      ingredients: [{ ...emptyIngredient, name: "פאן סוויס" }],
      suppliers: [alsunbola],
    });
    const pan = plan.rows.filter((row) => row.canonicalName === "פאן סוויס קפוא");
    expect(pan.every((row) => row.identity === "uncertain")).toBe(true);
    expect(pan.every((row) => !isWritablePurchaseRow(row))).toBe(true);
    const accepted = planPurchaseList({
      text: SAMPLE,
      ingredients: [{ ...emptyIngredient, name: "פאן סוויס" }],
      suppliers: [alsunbola],
      decisions: Object.fromEntries(pan.map((row) => [row.key, { acceptSuggest: true, ingredientId: "pan-existing" }])),
    });
    expect(accepted.rows.filter((row) => row.canonicalName === "פאן סוויס קפוא").every((row) => row.identity === "existing")).toBe(true);
  });

  it("checks invoice duplicates by supplier and document number", () => {
    const invoices: PurchaseInvoice[] = [
      {
        id: "inv-1",
        supplierId: "sup-alsunbola",
        supplierName: "אלסונבולה שיווק מוצרי מזון בע״מ",
        invoiceNumber: "10226",
        invoiceDate: "2026-09-03",
        receivedAt: "2026-09-03",
        status: "draft",
        lines: [],
        createdAt: "",
      },
    ];
    expect(purchaseInvoiceDuplicate(invoices, "sup-alsunbola", "10226")).toBe(true);
    expect(purchaseInvoiceDuplicate(invoices, "other", "10226")).toBe(false);
    const plan = planPurchaseList({
      text: SAMPLE,
      ingredients: [emptyIngredient],
      suppliers: [alsunbola],
      invoices,
    });
    expect(plan.rows.filter((row) => row.invoiceNumber === "10226").every((row) => row.duplicateInvoice)).toBe(true);
    expect(plan.rows.filter((row) => row.invoiceNumber === "10252").every((row) => !row.duplicateInvoice)).toBe(true);
  });

  it("keeps source line amounts instead of rewriting them from unit price", () => {
    const plan = planPurchaseList({
      text: SAMPLE,
      ingredients: [emptyIngredient],
      suppliers: [alsunbola],
    });
    const second = plan.rows.find((row) => row.invoiceNumber === "10252" && row.canonicalName === "פאן סוויס קפוא");
    expect(second?.unitPrice).toBe(52);
    expect(second?.lineNet).toBe(104);
    expect(second?.lineGross).toBe(122.72);
  });
});
