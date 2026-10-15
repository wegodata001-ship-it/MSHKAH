import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseZExtraction, toPrintedDateTime } from "@/lib/ai/gemini-z-report";
import {
  canPostZReport,
  classifyPaymentRole,
  compareExcelToZ,
  financeTenders,
  findDuplicateZReport,
  isEmptyZExtraction,
  isExtraZLabel,
  missingNotZero,
  overlappingPostedZReports,
  overlapRequiresAck,
  periodNeedsConfirm,
  websiteSalesOverlap,
  zAmountToPost,
} from "@/lib/inventory/pos-z";
import type { PosZReport } from "@/lib/inventory/types";
import type { Order } from "@/types";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/z-report-oct-2026.json"), "utf8"));

function report(extras: Partial<PosZReport> = {}): PosZReport {
  return {
    id: extras.id ?? "z1",
    reportNumber: "88",
    registerId: "1",
    businessName: "משקאה",
    businessDate: "2026-10-01",
    periodFrom: "2026-10-01",
    periodTo: "2026-10-01",
    salesTotal: 1200,
    vatTotal: 180,
    status: "draft",
    createdAt: "2026-10-01",
    ...extras,
  };
}

function order(total: number, createdAt: string): Order {
  return {
    id: `o-${total}`,
    orderNumber: "1",
    customerId: "c",
    customerName: "c",
    status: "delivered",
    items: [{ productId: "p", productName: "p", quantity: 1, price: total }],
    total,
    paymentStatus: "paid",
    createdAt,
    paidAt: createdAt,
  };
}

describe("Z extraction keeps missing values empty", () => {
  it("does not coerce missing money fields to zero", () => {
    const parsed = parseZExtraction({
      reportNumber: "12",
      salesTotal: 500,
      vatTotal: null,
      returnsTotal: "",
      cashExpected: undefined,
    });
    expect(parsed.salesTotal).toBe(500);
    expect(parsed.vatTotal).toBeNull();
    expect(parsed.returnsTotal).toBeNull();
    expect(parsed.cashExpected).toBeNull();
    expect(missingNotZero(undefined)).toBeNull();
    expect(missingNotZero(0)).toBe(0);
  });
});

describe("Z finance posting rules", () => {
  it("posts once, blocks a second post, and treats cash as expected not counted", () => {
    const draft = report({ cashExpected: 300 });
    expect(canPostZReport(draft).ok).toBe(true);
    expect(zAmountToPost(draft)).toBe(1200);
    expect(canPostZReport(report({ status: "posted", financeEntryId: "z-finance-z1" })).ok).toBe(false);
    expect(canPostZReport(report({ salesTotal: null })).ok).toBe(false);
    expect(draft.cashExpected).not.toBe(draft.salesTotal);
  });

  it("detects the same report by register, number, date and source amounts, not filename", () => {
    const existing = [report({ id: "old", fileHash: "aaa" })];
    expect(findDuplicateZReport(existing, report({ id: "new", fileHash: "bbb" }))?.id).toBe("old");
    expect(findDuplicateZReport(existing, report({ id: "new", reportNumber: "99", fileHash: "ccc" }))).toBeNull();
    expect(findDuplicateZReport(existing, report({ id: "new", reportNumber: null, fileHash: "aaa" }))?.id).toBe("old");
  });

  it("requires acknowledgement when website sales already sit in the same period", () => {
    const overlap = websiteSalesOverlap([order(80, "2026-10-01T12:00:00.000Z")], "2026-10-01", "2026-10-01");
    expect(overlap.orderCount).toBeGreaterThan(0);
    expect(overlapRequiresAck(overlap)).toBe(true);
    expect(overlapRequiresAck({ orderCount: 0, amount: 0 })).toBe(false);
  });
});

describe("Excel to Z compare is control only", () => {
  it("shows no Z, partial cover, or match without inventing a daily split", () => {
    expect(compareExcelToZ({ excelRevenue: 62246, zSales: null, sameRegister: true, overlappingPeriod: false })).toBe("no-z");
    expect(compareExcelToZ({ excelRevenue: 62246, zSales: 2000, sameRegister: true, overlappingPeriod: true })).toBe("partial");
    expect(compareExcelToZ({ excelRevenue: 1200, zSales: 1200, sameRegister: true, overlappingPeriod: true })).toBe("match");
  });
});

describe("attached Z report fixture parsing", () => {
  const parsed = parseZExtraction(fixture);

  it("keeps the header range and printed datetime separately", () => {
    expect(parsed.periodFrom).toBe("2026-10-01");
    expect(parsed.periodTo).toBe("2026-10-31");
    expect(toPrintedDateTime("08/10/2026 14:30")).toBe("2026-10-08T14:30:00");
    expect(parsed.printedAt).toBe("2026-10-08T14:30:00");
    expect(parsed.businessDate).toBeNull();
    expect(periodNeedsConfirm({ ...parsed, id: "f", status: "draft", createdAt: "x" })).toBe(true);
    expect(canPostZReport({ ...parsed, id: "f", status: "draft", createdAt: "x" }).ok).toBe(false);
    expect(canPostZReport({ ...parsed, id: "f", status: "draft", createdAt: "x", periodConfirmed: true }).ok).toBe(true);
  });

  it("extracts tenders, counts, sales, VAT and extras without guessing", () => {
    const byLabel = Object.fromEntries((parsed.payments ?? []).map((row) => [row.sourceLabel || row.method, row]));
    expect(byLabel["אשראי"]?.amount).toBeCloseTo(5375.6);
    expect(byLabel["אשראי"]?.count).toBe(71);
    expect(byLabel["אשראי ידני"]?.amount).toBeCloseTo(100);
    expect(byLabel["אשראי ידני"]?.count).toBe(1);
    expect(byLabel["מזומן"]?.amount).toBeCloseTo(10416.9);
    expect(byLabel["מזומן"]?.count).toBe(137);
    expect(byLabel["סיכום אשראי"]?.amount).toBeCloseTo(5475.6);
    expect(byLabel["סיכום אשראי"]?.count).toBe(72);
    expect(classifyPaymentRole("סיכום אשראי")).toBe("tender-summary");
    expect(financeTenders(parsed.payments).some((row) => (row.sourceLabel || row.method).includes("סיכום"))).toBe(false);
    expect(parsed.salesBeforeVat).toBeCloseTo(13468.22);
    expect(parsed.vatTotal).toBeCloseTo(2424.28);
    expect(parsed.salesIncludingVat).toBeCloseTo(15892.5);
    expect(parsed.receiptsTotal).toBeCloseTo(15892.5);
    expect(parsed.receiptsCount).toBe(209);
    expect(parsed.returnsTotal).toBeNull();
    expect(parsed.discountsTotal).toBeNull();
    expect(parsed.extraAmounts?.map((row) => row.sourceLabel)).toEqual(["דמי מחזור", "מצטבר כללי"]);
    expect(parsed.extraAmounts?.[0].amount).toBeCloseTo(2064);
    expect(parsed.extraAmounts?.[1].amount).toBeCloseTo(131063.4);
    expect(isExtraZLabel("דמי מחזור")).toBe(true);
    expect(zAmountToPost({ ...parsed, id: "f", status: "draft", createdAt: "x" })).toBeCloseTo(15892.5);
    expect(zAmountToPost({ ...parsed, id: "f", status: "draft", createdAt: "x" })).not.toBeCloseTo(131063.4);
  });

  it("shows amount checks without rewriting values to force a match", () => {
    const byId = Object.fromEntries((parsed.checks ?? []).map((row) => [row.id, row]));
    expect(byId["credit-summary"]?.ok).toBe(true);
    expect(byId["receipts"]?.ok).toBe(true);
    expect(byId["sales-vat"]?.ok).toBe(true);
    expect(byId["sales-vs-receipts"]?.ok).toBe(true);
    const broken = parseZExtraction({ ...fixture, vatTotal: 2000 });
    expect(broken.vatTotal).toBe(2000);
    expect(broken.salesBeforeVat).toBeCloseTo(13468.22);
    expect(broken.checks?.find((row) => row.id === "sales-vat")?.ok).toBe(false);
  });

  it("does not treat an empty scan as success and keeps unread fields missing", () => {
    const empty = parseZExtraction({});
    expect(isEmptyZExtraction(empty)).toBe(true);
    expect(empty.scanStatus).toBe("failed");
    expect(empty.salesTotal).toBeNull();
    expect(canPostZReport({ ...empty, id: "e", status: "draft", createdAt: "x" }).ok).toBe(false);
  });

  it("flags overlapping posted Z periods without creating a second income from extras", () => {
    const posted = report({
      id: "old-range",
      status: "posted",
      periodFrom: "2026-10-01",
      periodTo: "2026-10-31",
      salesTotal: 100,
    });
    const next = { ...parsed, id: "new-range", status: "draft" as const, createdAt: "x" };
    expect(overlappingPostedZReports([posted], next).map((item) => item.id)).toEqual(["old-range"]);
    expect(financeTenders(parsed.payments).reduce((sum, row) => sum + (row.amount ?? 0), 0)).toBeCloseTo(5375.6 + 100 + 10416.9);
  });
});
