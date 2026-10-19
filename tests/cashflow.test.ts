import { describe, expect, it } from "vitest";
import { monthlyEquivalent } from "@/lib/breakeven/compute";
import type { BreakEvenFixedCost } from "@/lib/breakeven/types";
import {
  billingDayFromDate,
  buildCashFlow,
  clampBillingDate,
  fixedCashAmount,
  paymentDates,
  posExcelCashInflows,
  type CashFlowEntry,
} from "@/lib/cashflow/engine";

function cost(partial: Partial<BreakEvenFixedCost> & Pick<BreakEvenFixedCost, "id" | "name" | "amount">): BreakEvenFixedCost {
  return {
    frequency: "monthly",
    vatMode: "including",
    active: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  };
}

const october = { rangeStart: "2026-10-01", rangeEnd: "2026-10-31", today: "2026-10-01" };

describe("cash flow schedule", () => {
  it("keeps a monthly billing day and uses the month end only when that day is missing", () => {
    const billingDay = 31;
    const dates = paymentDates({
      frequency: "monthly",
      billingDay,
      start: "2026-01-31",
      rangeStart: "2026-01-01",
      rangeEnd: "2026-04-30",
    });
    expect(dates.map((item) => item.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(billingDay).toBe(31);
    expect(clampBillingDate(2024, 2, 31)).toBe("2024-02-29");
    expect(billingDayFromDate("2026-10-10")).toBe(10);
  });

  it("shows a yearly payment in full on its date and keeps the monthly break-even share separate", () => {
    const yearly = cost({
      id: "insurance",
      name: "ביטוח",
      amount: 12000,
      frequency: "yearly",
      paymentFrequency: "yearly",
      billingDay: 1,
      billingStart: "2026-03-01",
    });
    expect(monthlyEquivalent(yearly.amount, yearly.frequency, 26)).toBeCloseTo(1000);
    const flow = buildCashFlow({
      fixed: [yearly],
      opening: { amount: 0, date: "2026-01-01" },
      rangeStart: "2026-01-01",
      rangeEnd: "2026-12-31",
      today: "2026-01-01",
    });
    expect(flow.outflows).toBe(12000);
    expect(flow.lines.map((line) => line.date)).toEqual(["2026-03-01"]);
  });

  it("adds VAT only on the cash amount when the break-even amount is before VAT", () => {
    const rent = cost({
      id: "rent",
      name: "שכירות",
      amount: 5000,
      vatMode: "before",
      vatRate: 0.18,
      paymentFrequency: "monthly",
      billingDay: 10,
      billingStart: "2026-10-10",
    });
    expect(monthlyEquivalent(rent.amount, "monthly", 26)).toBe(5000);
    expect(fixedCashAmount(rent)).toBe(5900);
    const flow = buildCashFlow({ fixed: [rent], opening: { amount: 10000, date: "2026-10-01" }, ...october });
    expect(flow.lines[0]?.outflow).toBe(5900);
    expect(flow.closing).toBe(4100);
  });

  it("reduces a planned charge by a partial payment on another date without paying it twice", () => {
    const rent = cost({
      id: "rent",
      name: "שכירות",
      amount: 5000,
      paymentFrequency: "monthly",
      billingDay: 10,
      billingStart: "2026-10-10",
    });
    const payment: CashFlowEntry = {
      id: "pay-1",
      kind: "settlement",
      direction: "out",
      amount: 2000,
      date: "2026-10-12",
      appliesToKey: "rent:2026-10",
    };
    const flow = buildCashFlow({
      fixed: [rent],
      entries: [payment],
      opening: { amount: 10000, date: "2026-10-01" },
      ...october,
    });
    expect(flow.outflows).toBe(5000);
    expect(flow.closing).toBe(5000);
    expect(flow.lines.map((line) => [line.date, line.outflow, line.status])).toEqual([
      ["2026-10-10", 3000, "partial"],
      ["2026-10-12", 2000, "done"],
    ]);
    expect(flow.closing).toBeCloseTo((flow.opening ?? 0) + flow.inflows - flow.outflows);
  });

  it("replaces the forecast when the planned charge is fully paid on a different date", () => {
    const rent = cost({
      id: "rent",
      name: "שכירות",
      amount: 5000,
      paymentFrequency: "monthly",
      billingDay: 10,
      billingStart: "2026-10-10",
    });
    const flow = buildCashFlow({
      fixed: [rent],
      entries: [{ id: "pay", kind: "settlement", direction: "out", amount: 5000, date: "2026-10-12", appliesToKey: "rent:2026-10" }],
      opening: { amount: 8000, date: "2026-10-01" },
      ...october,
    });
    expect(flow.lines).toHaveLength(1);
    expect(flow.lines[0]).toMatchObject({ date: "2026-10-12", outflow: 5000, status: "done" });
    expect(flow.closing).toBe(3000);
  });

  it("moves one occurrence or all future occurrences without touching an earlier month", () => {
    const rent = cost({
      id: "rent",
      name: "שכירות",
      amount: 5000,
      paymentFrequency: "monthly",
      billingDay: 10,
      billingStart: "2026-09-10",
    });
    const instance = buildCashFlow({
      fixed: [rent],
      entries: [{ id: "edit", kind: "override", scope: "instance", fixedCostId: "rent", occurrenceKey: "rent:2026-10", originalDate: "2026-10-10", date: "2026-10-15" }],
      opening: { amount: 0, date: "2026-09-01" },
      rangeStart: "2026-09-01",
      rangeEnd: "2026-11-30",
      today: "2026-09-01",
    });
    expect(instance.lines.map((line) => line.date)).toEqual(["2026-09-10", "2026-10-15", "2026-11-10"]);
    const future = buildCashFlow({
      fixed: [rent],
      entries: [{ id: "edit", kind: "override", scope: "future", fixedCostId: "rent", originalDate: "2026-10-10", date: "2026-10-15", amount: 4500 }],
      opening: { amount: 0, date: "2026-09-01" },
      rangeStart: "2026-09-01",
      rangeEnd: "2026-11-30",
      today: "2026-09-01",
    });
    expect(future.lines.map((line) => [line.date, line.outflow])).toEqual([
      ["2026-09-10", 5000],
      ["2026-10-15", 4500],
      ["2026-11-15", 4500],
    ]);
  });

  it("lets a linked supplier invoice replace the fixed-cost forecast", () => {
    const rent = cost({
      id: "rent",
      name: "שכירות",
      amount: 5000,
      paymentFrequency: "monthly",
      billingDay: 10,
      billingStart: "2026-10-10",
    });
    const flow = buildCashFlow({
      fixed: [rent],
      invoices: [{ id: "inv", supplierName: "בעל הנכס", invoiceNumber: "100", dueDate: "2026-10-20", gross: 5900 }],
      entries: [{ id: "link", kind: "link", fixedCostId: "rent", occurrenceKey: "rent:2026-10", invoiceId: "inv" }],
      opening: { amount: 6000, date: "2026-10-01" },
      ...october,
    });
    expect(flow.lines.map((line) => [line.source, line.outflow, line.date])).toEqual([["invoice", 5900, "2026-10-20"]]);
    expect(flow.closing).toBe(100);
  });

  it("keeps an internal transfer out of income and out of the closing change", () => {
    const flow = buildCashFlow({
      fixed: [],
      entries: [{ id: "move", kind: "transfer", amount: 400, date: "2026-10-05", description: "הפקדת מזומן" }],
      opening: { amount: 1000, date: "2026-10-01" },
      ...october,
    });
    expect(flow.inflows).toBe(0);
    expect(flow.outflows).toBe(0);
    expect(flow.closing).toBe(1000);
    expect(flow.lines[0]).toMatchObject({ inflow: 400, outflow: 400, source: "transfer" });
  });

  it("does not invent an opening balance, a payment date, or a card settlement", () => {
    const rent = cost({ id: "rent", name: "שכירות", amount: 5000 });
    const flow = buildCashFlow({
      fixed: [rent],
      invoices: [{ id: "inv", supplierName: "ספק", gross: 100, net: 84.75 }],
      zPayments: [{ reportId: "z1", businessDate: "2026-10-02", method: "אשראי", amount: 200 }],
      opening: null,
      posExcelRows: [{ amount: 999 }],
      ...october,
    });
    expect(flow.openingSet).toBe(false);
    expect(flow.opening).toBeNull();
    expect(flow.closing).toBeNull();
    expect(flow.lines.every((line) => line.balance == null)).toBe(true);
    expect(flow.undated.map((line) => line.missing)).toEqual(["payment-date", "due-date"]);
    expect(flow.needsSettlement).toHaveLength(1);
    expect(flow.inflows).toBe(0);
    expect(posExcelCashInflows()).toEqual([]);
  });

  it("counts a settled card receipt on the settlement date and keeps the balance identity", () => {
    const flow = buildCashFlow({
      fixed: [],
      zPayments: [{ reportId: "z1", businessDate: "2026-10-02", method: "אשראי", amount: 200 }],
      entries: [{ id: "card", kind: "settlement", direction: "in", zReportId: "z1", paymentMethod: "אשראי", amount: 200, date: "2026-10-16", moneyLocation: "bank" }],
      opening: { amount: 50, date: "2026-10-01" },
      ...october,
    });
    expect(flow.needsSettlement).toHaveLength(0);
    expect(flow.inflows).toBe(200);
    expect(flow.lines[0]).toMatchObject({ date: "2026-10-16", status: "done", inflow: 200 });
    expect(flow.closing).toBeCloseTo((flow.opening ?? 0) + flow.inflows - flow.outflows);
  });

  it("leaves a manual forecast expected until a receipt is recorded", () => {
    const forecast: CashFlowEntry = { id: "manual", kind: "forecast", direction: "in", amount: 300, date: "2026-10-18", description: "החזר" };
    const open = buildCashFlow({ fixed: [], entries: [forecast], opening: { amount: 0, date: "2026-10-01" }, ...october });
    expect(open.lines[0]).toMatchObject({ status: "expected", inflow: 300, outflow: 0 });
    const paid = buildCashFlow({
      fixed: [],
      entries: [forecast, { id: "got", kind: "settlement", direction: "in", amount: 300, date: "2026-10-19", appliesToKey: "manual:manual" }],
      opening: { amount: 0, date: "2026-10-01" },
      ...october,
    });
    expect(paid.lines.map((line) => line.status)).toEqual(["done"]);
    expect(paid.inflows).toBe(300);
  });
});
