import { describe, it, expect } from "vitest";
import {
  planInvoiceCancellation,
  planHasWarnings,
  planIsExecutable,
  counterMovementIdFor,
} from "@/lib/inventory/invoice-cancel";
import type {
  InventoryMovement,
  PurchaseInvoice,
  PurchaseInvoiceLine,
} from "@/lib/inventory/types";

function makeInvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "inv-1",
    supplierId: "sup-a",
    supplierName: "Supplier A",
    invoiceNumber: "100",
    invoiceDate: "2026-10-01",
    receivedAt: "2026-10-01",
    status: "saved",
    lines: [],
    createdAt: "2026-10-01",
    ...overrides,
  };
}

function makeLine(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    key: overrides.key ?? "line-1",
    rawName: "Flour",
    productId: "prod-flour",
    quantity: 10,
    unit: "kg",
    unitPrice: 5,
    discount: 0,
    lineTotal: 50,
    vatType: "inclusive",
    vatRate: 0.18,
    priceBeforeVat: 50,
    vatAmount: 9,
    priceIncludingVat: 59,
    postedToStock: true,
    ...overrides,
  };
}

function makeMovement(overrides: Partial<InventoryMovement> & { id: string }): InventoryMovement {
  return {
    id: overrides.id,
    productId: "prod-flour",
    type: "PURCHASE_IN",
    quantity: 10,
    unit: "kg",
    quantityBase: 10000,
    invoiceId: "inv-1",
    receivedAt: "2026-10-01",
    createdAt: "2026-10-01",
    ...overrides,
  };
}

describe("planInvoiceCancellation", () => {
  it("marks invoice without any stock movements as 'no-stock'", () => {
    const invoice = makeInvoice({ lines: [makeLine({ postedToStock: false })] });
    const plan = planInvoiceCancellation({ invoice, movements: [] });

    expect(plan.status).toBe("no-stock");
    expect(plan.hasStockHistory).toBe(false);
    expect(plan.movements).toHaveLength(0);
    expect(planIsExecutable(plan)).toBe(true);
    expect(planHasWarnings(plan)).toBe(false);
  });

  it("plans a full reversal when the invoice is clean and balance stays positive", () => {
    const invoice = makeInvoice({ lines: [makeLine()] });
    const movements: InventoryMovement[] = [
      makeMovement({ id: "mov-1", invoiceLineKey: "line-1" }),
      // consumption we must not touch
      makeMovement({
        id: "mov-sale",
        type: "SALE_OUT",
        invoiceId: undefined,
        orderId: "order-1",
        quantity: 4,
        quantityBase: 4000,
      }),
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("ready");
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0].sourceId).toBe("mov-1");
    expect(plan.movements[0].remainingBaseQty).toBe(10000);
    expect(plan.movements[0].currentBalance).toBe(6000); // 10 kg in, 4 kg sold
    expect(plan.movements[0].expectedAfter).toBe(-4000);
    expect(plan.movements[0].counterMovementId).toBe(counterMovementIdFor("mov-1"));
    expect(planIsExecutable(plan)).toBe(true);
    // 4 kg already consumed → the plan surfaces the negative-after warning,
    // but still allows execution per the policy.
    expect(planHasWarnings(plan)).toBe(true);
    expect(plan.negativeAfter).toHaveLength(1);
  });

  it("does not reduce stock twice when a reversal is already recorded", () => {
    const invoice = makeInvoice({ lines: [makeLine()] });
    const movements: InventoryMovement[] = [
      makeMovement({ id: "mov-1", invoiceLineKey: "line-1" }),
      {
        id: "rev-mov-1",
        productId: "prod-flour",
        type: "REVERSAL",
        quantity: 10000,
        unit: "g",
        quantityBase: -10000,
        reversesId: "mov-1",
        invoiceId: "inv-1",
        receivedAt: "2026-10-02",
        createdAt: "2026-10-02",
      },
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("already-reversed");
    expect(plan.movements[0].remainingBaseQty).toBe(0);
    expect(plan.movements[0].alreadyReversedBase).toBe(10000);
    // A re-run should be safely idempotent — the executable flag only
    // returns true for ready/no-stock plans.
    expect(planIsExecutable(plan)).toBe(false);
  });

  it("handles partial prior reversal: counter the remaining base qty only", () => {
    const invoice = makeInvoice({ lines: [makeLine()] });
    const movements: InventoryMovement[] = [
      makeMovement({ id: "mov-1", invoiceLineKey: "line-1" }),
      {
        id: "rev-partial",
        productId: "prod-flour",
        type: "REVERSAL",
        quantity: 3000,
        unit: "g",
        quantityBase: -3000,
        reversesId: "mov-1",
        invoiceId: "inv-1",
        receivedAt: "2026-10-02",
        createdAt: "2026-10-02",
      },
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("ready");
    expect(plan.movements[0].alreadyReversedBase).toBe(3000);
    expect(plan.movements[0].remainingBaseQty).toBe(7000);
    // Balance = 10 kg − 3 kg reversed = 7 kg; after this cancel it goes to 0.
    expect(plan.movements[0].currentBalance).toBe(7000);
    expect(plan.movements[0].expectedAfter).toBe(0);
    expect(planHasWarnings(plan)).toBe(false);
  });

  it("flags broken links when a posted line has no matching movement", () => {
    const invoice = makeInvoice({
      lines: [
        makeLine({ key: "line-1" }),
        makeLine({ key: "line-missing", rawName: "Sugar", productId: "prod-sugar" }),
      ],
    });
    const movements: InventoryMovement[] = [
      makeMovement({ id: "mov-1", invoiceLineKey: "line-1" }),
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("broken-link");
    expect(plan.brokenLinks).toHaveLength(1);
    expect(plan.brokenLinks[0]).toMatchObject({
      invoiceLineKey: "line-missing",
      reason: "no-movement",
    });
    expect(planIsExecutable(plan)).toBe(false);
  });

  it("flags broken link when the movement is missing a productId", () => {
    const invoice = makeInvoice({ lines: [makeLine()] });
    const movements: InventoryMovement[] = [
      makeMovement({
        id: "mov-1",
        invoiceLineKey: "line-1",
        productId: "",
      }) as InventoryMovement,
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("broken-link");
    expect(plan.brokenLinks[0].reason).toBe("missing-product");
  });

  it("sums multiple PURCHASE_IN movements for the same invoice independently", () => {
    const invoice = makeInvoice({
      lines: [
        makeLine({ key: "line-1" }),
        makeLine({ key: "line-2", rawName: "Sugar", productId: "prod-sugar" }),
      ],
    });
    const movements: InventoryMovement[] = [
      makeMovement({ id: "mov-1", invoiceLineKey: "line-1" }),
      makeMovement({
        id: "mov-2",
        invoiceLineKey: "line-2",
        productId: "prod-sugar",
        quantity: 5,
        quantityBase: 5000,
      }),
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("ready");
    expect(plan.movements).toHaveLength(2);
    expect(plan.movements.map((m) => m.sourceId).sort()).toEqual(["mov-1", "mov-2"]);
    expect(plan.movements.find((m) => m.sourceId === "mov-1")!.remainingBaseQty).toBe(10000);
    expect(plan.movements.find((m) => m.sourceId === "mov-2")!.remainingBaseQty).toBe(5000);
  });

  it("short-circuits an already-cancelled invoice without duplicating work", () => {
    const invoice = makeInvoice({ status: "cancelled" });
    const plan = planInvoiceCancellation({ invoice, movements: [] });

    expect(plan.status).toBe("already-cancelled");
    expect(plan.movements).toHaveLength(0);
  });

  it("counts prior returns from the SAME invoice toward alreadyReversed", () => {
    const invoice = makeInvoice({ lines: [makeLine()] });
    const movements: InventoryMovement[] = [
      makeMovement({ id: "mov-1", invoiceLineKey: "line-1" }),
      // A return booked earlier against this invoice (e.g. partial refund).
      {
        id: "mov-return",
        productId: "prod-flour",
        type: "REVERSAL",
        quantity: 2000,
        unit: "g",
        quantityBase: -2000,
        reversesId: "mov-1",
        invoiceId: "inv-1",
        receivedAt: "2026-10-02",
        createdAt: "2026-10-02",
      },
    ];
    const plan = planInvoiceCancellation({ invoice, movements });

    expect(plan.status).toBe("ready");
    expect(plan.movements[0].alreadyReversedBase).toBe(2000);
    expect(plan.movements[0].remainingBaseQty).toBe(8000);
    expect(plan.movements[0].expectedAfter).toBe(0);
  });
});
