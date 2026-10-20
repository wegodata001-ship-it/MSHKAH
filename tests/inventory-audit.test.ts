import { describe, expect, it } from "vitest";
import {
  findReconciliationIssues,
  reconcileBalances,
} from "@/lib/inventory/reconciliation";
import { packNeedsCompletion } from "@/lib/inventory/ingredient-core";
import { evaluateStockPostPolicy } from "@/lib/inventory/stock-post-policy";
import { planQuantityCorrection, priorCorrectionDelta } from "@/lib/inventory/quantity-correction";
import { planInvoiceCancellation } from "@/lib/inventory/invoice-cancel";
import type { InventoryMovement } from "@/lib/inventory/types";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

function move(overrides: Partial<InventoryMovement>): InventoryMovement {
  return {
    id: "m-" + Math.random().toString(36).slice(2),
    productId: "milk",
    type: "PURCHASE_IN",
    quantity: 1,
    unit: "liter",
    quantityBase: 1000,
    receivedAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("reconcileBalances — section 14 invariant", () => {
  it("sums opening + in − out + reversal + adjustment and reports mismatch", () => {
    const movements: InventoryMovement[] = [
      move({ type: "OPENING", quantityBase: 20_000 }),
      move({ type: "PURCHASE_IN", quantityBase: 10_000 }),
      move({ type: "SALE_OUT", quantityBase: 4_000 }),
      // A reversal for the sale (+4000 back into stock)
      move({ type: "REVERSAL", quantityBase: 4_000, reversesId: "x" }),
      // A reversal for a purchase (-3000 out of stock, return to supplier)
      move({ type: "REVERSAL", quantityBase: -3_000, reversesId: "y" }),
    ];
    const [row] = reconcileBalances({
      movements,
      storedBalances: [{ productId: "milk", storedBase: 27_000 }],
      productIds: ["milk"],
    });
    // 20000 + 10000 - 4000 + 4000 + (-3000) + 0 = 27000
    expect(row.computedBase).toBe(27_000);
    expect(row.storedBase).toBe(27_000);
    expect(row.hasMismatch).toBe(false);
    expect(row.isNegative).toBe(false);
  });

  it("flags mismatches when stored and computed differ", () => {
    const movements: InventoryMovement[] = [
      move({ type: "OPENING", quantityBase: 1_000 }),
      move({ type: "PURCHASE_IN", quantityBase: 500 }),
    ];
    const [row] = reconcileBalances({
      movements,
      storedBalances: [{ productId: "milk", storedBase: 1_300 }],
      productIds: ["milk"],
    });
    expect(row.computedBase).toBe(1_500);
    expect(row.storedBase).toBe(1_300);
    expect(row.hasMismatch).toBe(true);
    expect(row.deltaBase).toBe(200);
  });

  it("flags negative computed balances without hiding them as zero", () => {
    const movements: InventoryMovement[] = [
      move({ type: "OPENING", quantityBase: 500 }),
      move({ type: "SALE_OUT", quantityBase: 800 }),
    ];
    const [row] = reconcileBalances({
      movements,
      storedBalances: [{ productId: "milk", storedBase: -300 }],
      productIds: ["milk"],
    });
    expect(row.computedBase).toBe(-300);
    expect(row.isNegative).toBe(true);
    expect(row.hasMismatch).toBe(false); // stored and computed agree
  });

  it("ignores movements for products not in the audit scope", () => {
    const movements: InventoryMovement[] = [
      move({ productId: "milk", type: "PURCHASE_IN", quantityBase: 1_000 }),
      move({ productId: "flour", type: "PURCHASE_IN", quantityBase: 5_000 }),
    ];
    const rows = reconcileBalances({
      movements,
      storedBalances: [{ productId: "milk", storedBase: 1_000 }],
      productIds: ["milk"],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe("milk");
    expect(rows[0].computedBase).toBe(1_000);
  });

  it("findReconciliationIssues isolates mismatches + negatives", () => {
    const rows = reconcileBalances({
      movements: [
        move({ productId: "milk", type: "OPENING", quantityBase: 100 }),
        move({ productId: "flour", type: "SALE_OUT", quantityBase: 300 }),
      ],
      storedBalances: [
        { productId: "milk", storedBase: 50 },
        { productId: "flour", storedBase: -300 },
      ],
      productIds: ["milk", "flour"],
    });
    const { mismatches, negatives } = findReconciliationIssues(rows);
    expect(mismatches.map((row) => row.productId)).toEqual(["milk"]);
    expect(negatives.map((row) => row.productId)).toEqual(["flour"]);
  });
});

describe("packNeedsCompletion — section 9 pack ratio enforcement", () => {
  function line(overrides: Partial<PurchaseInvoiceLine>): Pick<PurchaseInvoiceLine, "unit" | "conversionFactor"> {
    return {
      unit: "unit",
      conversionFactor: undefined,
      ...overrides,
    };
  }

  it("blocks 'unit' purchase on a ml-based product with no conversion factor", () => {
    // 3 boxes of milk with no ratio set → must be flagged.
    expect(packNeedsCompletion(line({ unit: "unit" }), "ml")).toBe(true);
  });

  it("accepts the same line once an admin provides the ratio", () => {
    expect(packNeedsCompletion(line({ unit: "unit", conversionFactor: 12_000 }), "ml")).toBe(false);
  });

  it("accepts a 'liter' purchase on a ml-based product without any extra ratio", () => {
    expect(packNeedsCompletion(line({ unit: "liter" }), "ml")).toBe(false);
  });

  it("blocks lines with no unit at all", () => {
    expect(
      packNeedsCompletion(
        { unit: undefined as unknown as PurchaseInvoiceLine["unit"], conversionFactor: undefined },
        "g"
      )
    ).toBe(true);
  });

  it("allows a 'unit' purchase when the product itself is unit-based", () => {
    // Example: boxes of 1 bottle each, product measured in bottles.
    expect(packNeedsCompletion(line({ unit: "unit" }), "unit")).toBe(false);
  });
});

describe("stock post policy — delivery note then invoice", () => {
  it("blocks a credit document from being posted as a stock receipt", () => {
    expect(
      evaluateStockPostPolicy({ documentType: "credit", linked: [] }).allow
    ).toBe(false);
  });

  it("blocks an invoice when the linked delivery already received the goods", () => {
    const decision = evaluateStockPostPolicy({
      documentType: "tax_invoice",
      coversDeliveryIds: ["del-1"],
      linked: [{ id: "del-1", documentType: "delivery", stockStatus: "posted" }],
    });
    expect(decision).toEqual({ allow: false, code: "ALREADY_RECEIVED" });
  });

  it("allows the invoice when the delivery has not been posted to stock", () => {
    const decision = evaluateStockPostPolicy({
      documentType: "invoice",
      coversDeliveryIds: ["del-1"],
      linked: [{ id: "del-1", documentType: "delivery", stockStatus: "none" }],
    });
    expect(decision.allow).toBe(true);
  });
});

describe("posted quantity correction", () => {
  it("corrects 20 down to 15 with a −5 delta and does not repeat it", () => {
    const first = planQuantityCorrection({
      originalBase: 20,
      correctedBase: 15,
      priorDeltaBase: 0,
    });
    expect(first.deltaBase).toBe(-5);
    expect(first.noop).toBe(false);
    const second = planQuantityCorrection({
      originalBase: 20,
      correctedBase: 15,
      priorDeltaBase: first.deltaBase,
    });
    expect(second.noop).toBe(true);
    expect(second.deltaBase).toBe(0);
  });

  it("ignores a price-only edit because the quantity does not change", () => {
    const plan = planQuantityCorrection({
      originalBase: 20,
      correctedBase: 20,
      priorDeltaBase: 0,
    });
    expect(plan.noop).toBe(true);
  });

  it("cancel reverses the corrected quantity, not the original receipt", () => {
    const plan = planInvoiceCancellation({
      invoice: {
        id: "inv-1",
        supplierName: "A",
        invoiceNumber: "1",
        invoiceDate: "2026-10-01",
        receivedAt: "2026-10-01",
        status: "saved",
        lines: [
          {
            key: "line-1",
            rawName: "Milk",
            productId: "milk",
            quantity: 15,
            unit: "liter",
            unitPrice: 1,
            discount: 0,
            lineTotal: 15,
            vatType: "inclusive",
            vatRate: 0.18,
            priceBeforeVat: 15,
            vatAmount: 0,
            priceIncludingVat: 15,
            postedToStock: true,
          },
        ],
        createdAt: "2026-10-01",
      },
      movements: [
        move({
          id: "in-inv-1-line-1",
          type: "PURCHASE_IN",
          invoiceId: "inv-1",
          invoiceLineKey: "line-1",
          quantityBase: 20_000,
        }),
        move({
          id: "qtyfix-1",
          type: "ADJUSTMENT",
          invoiceId: "inv-1",
          invoiceLineKey: "line-1",
          correctsMovementId: "in-inv-1-line-1",
          quantityBase: -5_000,
        }),
      ],
    });
    expect(plan.movements[0].remainingBaseQty).toBe(15_000);
    expect(
      priorCorrectionDelta(
        [{ type: "ADJUSTMENT", correctsMovementId: "in-inv-1-line-1", quantityBase: -5_000 }],
        "in-inv-1-line-1"
      )
    ).toBe(-5_000);
  });
});

describe("milk ledger example from the audit brief", () => {
  it("lands on 25 liters after in, out, return, and supplier return", () => {
    const liter = 1000;
    const [row] = reconcileBalances({
      productIds: ["milk"],
      storedBalances: [{ productId: "milk", storedBase: 25 * liter }],
      movements: [
        move({ type: "OPENING", quantityBase: 20 * liter }),
        move({ type: "PURCHASE_IN", quantityBase: 10 * liter }),
        move({ type: "ISSUE_OUT", quantityBase: 4 * liter }),
        move({ type: "ADJUSTMENT", quantityBase: 2 * liter }),
        move({ type: "ISSUE_OUT", quantityBase: 3 * liter, reason: "return" }),
      ],
    });
    expect(row.computedBase).toBe(25 * liter);
    expect(row.hasMismatch).toBe(false);
    expect(row.isNegative).toBe(false);
  });
});
