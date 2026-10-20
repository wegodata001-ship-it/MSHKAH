import type { PosSaleLine } from "@/lib/inventory/types";

/**
 * Sales math runs here, before any AI call. The model may explain these
 * numbers. It does not calculate them.
 */

export type VerifiedCost = {
  productId: string;
  unitCost: number;
  basis: "recipe" | "manual";
  listPrice: number | null;
};

export type SalesAnomaly =
  | "revenue_qty_mismatch"
  | "profit_mismatch"
  | "cost_shape_unknown"
  | "missing_verified_cost"
  | "unmatched_product"
  | "date_unrecognized";

export type ReportedCostKind = "unit" | "total" | "unknown" | "missing";

export type SalesProductFact = {
  key: string;
  name: string;
  menuProductId: string | null;
  matched: boolean;
  quantity: number;
  reportedRevenue: number | null;
  averagePrice: number | null;
  listPrice: number | null;
  reportedCost: number | null;
  reportedCostKind: ReportedCostKind;
  verifiedUnitCost: number | null;
  verifiedCostBasis: "recipe" | "manual" | null;
  verifiedTotalCost: number | null;
  verifiedGross: number | null;
  verifiedMarginPercent: number | null;
  verifiedFoodCostPercent: number | null;
  revenueShare: number | null;
  anomalies: SalesAnomaly[];
};

export type SalesReportFacts = {
  productCount: number;
  quantity: number;
  reportedRevenue: number | null;
  verifiedGross: number | null;
  verifiedRevenue: number | null;
  missingCostCount: number;
  unmatchedCount: number;
  anomalyCount: number;
  products: SalesProductFact[];
};

const MONEY_TOLERANCE = 1;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(MONEY_TOLERANCE, Math.abs(b) * 0.02);
}

export function classifyReportedCost(input: {
  quantity: number;
  revenue: number | null;
  reportedCost: number | null;
  reportedProfit: number | null;
}): ReportedCostKind {
  const cost = input.reportedCost;
  if (cost == null || !Number.isFinite(cost)) return "missing";
  const qty = input.quantity;
  if (!(qty > 0) || input.revenue == null) return "unknown";
  if (input.reportedProfit != null && Number.isFinite(input.reportedProfit)) {
    const implied = input.revenue - input.reportedProfit;
    if (close(cost, implied)) return "total";
    if (close(cost * qty, implied)) return "unit";
    return "unknown";
  }
  if (qty > 1 && cost < input.revenue && cost * qty <= input.revenue * 1.5) return "unit";
  if (cost <= input.revenue * 1.5) return "total";
  return "unknown";
}

export function simulatePriceChange(input: {
  currentPrice: number;
  nextPrice: number;
  quantity: number;
  verifiedUnitCost: number | null;
  demandDropPercent?: number;
}): {
  unitProfitBefore: number | null;
  unitProfitAfter: number | null;
  periodProfitBefore: number | null;
  periodProfitAfter: number | null;
  assumedQuantity: number;
  demandDropPercent: number;
} {
  const drop = Math.min(90, Math.max(0, input.demandDropPercent ?? 0));
  const assumedQuantity = roundMoney(input.quantity * (1 - drop / 100));
  if (input.verifiedUnitCost == null) {
    return {
      unitProfitBefore: null,
      unitProfitAfter: null,
      periodProfitBefore: null,
      periodProfitAfter: null,
      assumedQuantity,
      demandDropPercent: drop,
    };
  }
  const before = roundMoney(input.currentPrice - input.verifiedUnitCost);
  const after = roundMoney(input.nextPrice - input.verifiedUnitCost);
  return {
    unitProfitBefore: before,
    unitProfitAfter: after,
    periodProfitBefore: roundMoney(before * input.quantity),
    periodProfitAfter: roundMoney(after * assumedQuantity),
    assumedQuantity,
    demandDropPercent: drop,
  };
}

export function analyzeSalesLines(input: {
  lines: PosSaleLine[];
  verifiedCosts?: VerifiedCost[];
  periodRecognized: boolean;
}): SalesReportFacts {
  const costs = new Map((input.verifiedCosts ?? []).map((row) => [row.productId, row]));
  const active = input.lines.filter((line) => !line.excluded && line.lineKind !== "return");
  const drafts: SalesProductFact[] = active.map((line) => {
    const quantity = Number(line.quantity) || 0;
    const reportedRevenue = line.reportedRevenue ?? line.netTotal ?? null;
    const averagePrice =
      reportedRevenue != null && quantity > 0 ? roundMoney(reportedRevenue / quantity) : line.unitPrice ?? null;
    const verified = line.menuProductId ? costs.get(line.menuProductId) : undefined;
    const costKind = classifyReportedCost({
      quantity,
      revenue: reportedRevenue,
      reportedCost: line.posCost ?? null,
      reportedProfit: line.posProfit ?? null,
    });
    const anomalies: SalesAnomaly[] = [];
    if (line.unitPrice != null && reportedRevenue != null && quantity > 0) {
      const expected = line.unitPrice * quantity;
      if (!close(expected, reportedRevenue)) anomalies.push("revenue_qty_mismatch");
    }
    if (costKind === "unknown") anomalies.push("cost_shape_unknown");
    if (line.posProfit != null && reportedRevenue != null && line.posCost != null && costKind !== "unknown" && costKind !== "missing") {
      const totalCost = costKind === "unit" ? line.posCost * quantity : line.posCost;
      const impliedProfit = reportedRevenue - totalCost;
      if (!close(impliedProfit, line.posProfit)) anomalies.push("profit_mismatch");
    }
    if (!line.menuProductId || line.matchKind === "none" || line.matchKind === "suggest") {
      anomalies.push("unmatched_product");
    }
    if (!verified) anomalies.push("missing_verified_cost");
    if (!input.periodRecognized) anomalies.push("date_unrecognized");
    const verifiedUnitCost = verified ? verified.unitCost : null;
    const verifiedTotalCost =
      verifiedUnitCost != null && quantity > 0 ? roundMoney(verifiedUnitCost * quantity) : null;
    const verifiedGross =
      verifiedTotalCost != null && reportedRevenue != null ? roundMoney(reportedRevenue - verifiedTotalCost) : null;
    const verifiedMarginPercent =
      verifiedGross != null && reportedRevenue != null && reportedRevenue > 0
        ? roundMoney((verifiedGross / reportedRevenue) * 100)
        : null;
    const verifiedFoodCostPercent =
      verifiedTotalCost != null && reportedRevenue != null && reportedRevenue > 0
        ? roundMoney((verifiedTotalCost / reportedRevenue) * 100)
        : null;
    return {
      key: line.key,
      name: line.posName || line.posCode || line.key,
      menuProductId: line.menuProductId ?? null,
      matched: Boolean(line.menuProductId) && line.matchKind !== "suggest" && line.matchKind !== "none",
      quantity,
      reportedRevenue,
      averagePrice,
      listPrice: verified?.listPrice ?? null,
      reportedCost: line.posCost ?? null,
      reportedCostKind: costKind,
      verifiedUnitCost,
      verifiedCostBasis: verified?.basis ?? null,
      verifiedTotalCost,
      verifiedGross,
      verifiedMarginPercent,
      verifiedFoodCostPercent,
      revenueShare: null,
      anomalies,
    };
  });

  const revenueTotal = drafts.reduce((sum, row) => sum + (row.reportedRevenue ?? 0), 0);
  const hasRevenue = drafts.some((row) => row.reportedRevenue != null);
  const products = drafts.map((row) => ({
    ...row,
    revenueShare:
      hasRevenue && revenueTotal > 0 && row.reportedRevenue != null
        ? roundMoney((row.reportedRevenue / revenueTotal) * 100)
        : null,
  }));
  const verifiedRows = products.filter((row) => row.verifiedGross != null && row.reportedRevenue != null);
  return {
    productCount: products.length,
    quantity: roundMoney(products.reduce((sum, row) => sum + row.quantity, 0)),
    reportedRevenue: hasRevenue ? roundMoney(revenueTotal) : null,
    verifiedGross: verifiedRows.length
      ? roundMoney(verifiedRows.reduce((sum, row) => sum + (row.verifiedGross ?? 0), 0))
      : null,
    verifiedRevenue: verifiedRows.length
      ? roundMoney(verifiedRows.reduce((sum, row) => sum + (row.reportedRevenue ?? 0), 0))
      : null,
    missingCostCount: products.filter((row) => row.verifiedUnitCost == null).length,
    unmatchedCount: products.filter((row) => !row.matched).length,
    anomalyCount: products.filter((row) => row.anomalies.some((item) => item !== "missing_verified_cost" && item !== "date_unrecognized")).length,
    products,
  };
}

export type AdvisorKind =
  | "price"
  | "cost"
  | "winner"
  | "high_volume_low_margin"
  | "low_demand"
  | "inventory"
  | "data";

export type AdvisorCard = {
  id: string;
  productKey: string | null;
  productName: string;
  menuProductId: string | null;
  kind: AdvisorKind;
  severity: "high" | "medium" | "low";
  currentPrice: number | null;
  proposedPrice: number | null;
  why: string;
  evidence: string[];
  caveats: string[];
};

/** Deterministic recommendations from the calculated facts. AI may rephrase them, not replace the numbers. */
export function adviseFromFacts(facts: SalesReportFacts): AdvisorCard[] {
  const cards: AdvisorCard[] = [];
  const quantities = facts.products.map((row) => row.quantity).filter((qty) => qty > 0).sort((a, b) => a - b);
  const median = quantities.length ? quantities[Math.floor(quantities.length / 2)] : 0;

  if (facts.missingCostCount > 0) {
    cards.push({
      id: "stock-missing-cost",
      productKey: null,
      productName: "",
      menuProductId: null,
      kind: "inventory",
      severity: "medium",
      currentPrice: null,
      proposedPrice: null,
      why: "missing-verified-cost",
      evidence: [`missing:${facts.missingCostCount}`],
      caveats: ["no-automatic-purchase"],
    });
  }

  if (facts.products.some((row) => row.anomalies.includes("date_unrecognized"))) {
    cards.push({
      id: "data-period",
      productKey: null,
      productName: "",
      menuProductId: null,
      kind: "data",
      severity: "high",
      currentPrice: null,
      proposedPrice: null,
      why: "period-unrecognized",
      evidence: [],
      caveats: ["do-not-invent-date"],
    });
  }

  for (const row of facts.products) {
    if (row.anomalies.includes("revenue_qty_mismatch") || row.anomalies.includes("profit_mismatch") || row.reportedCostKind === "unknown") {
      cards.push({
        id: `data-${row.key}`,
        productKey: row.key,
        productName: row.name,
        menuProductId: row.menuProductId,
        kind: "data",
        severity: "high",
        currentPrice: row.averagePrice,
        proposedPrice: null,
        why: "figures-do-not-reconcile",
        evidence: row.anomalies,
        caveats: ["source-unchanged"],
      });
    }
    if (row.verifiedUnitCost == null) continue;
    const food = row.verifiedFoodCostPercent;
    const qtyHigh = median > 0 && row.quantity >= median;
    if (food != null && food >= 70 && qtyHigh) {
      const proposed = row.averagePrice != null ? roundMoney(row.verifiedUnitCost / 0.55) : null;
      cards.push({
        id: `price-${row.key}`,
        productKey: row.key,
        productName: row.name,
        menuProductId: row.menuProductId,
        kind: "high_volume_low_margin",
        severity: "high",
        currentPrice: row.averagePrice,
        proposedPrice: proposed,
        why: "high-volume-high-food-cost",
        evidence: [`foodCost:${food}`, `qty:${row.quantity}`],
        caveats: ["demand-not-guaranteed", "verify-recipe"],
      });
    } else if (food != null && food <= 30 && qtyHigh && (row.revenueShare ?? 0) >= 8) {
      cards.push({
        id: `winner-${row.key}`,
        productKey: row.key,
        productName: row.name,
        menuProductId: row.menuProductId,
        kind: "winner",
        severity: "medium",
        currentPrice: row.averagePrice,
        proposedPrice: null,
        why: "high-demand-and-margin",
        evidence: [`foodCost:${food}`, `share:${row.revenueShare}`],
        caveats: ["one-period"],
      });
    } else if (median > 0 && row.quantity > 0 && row.quantity < median * 0.25) {
      cards.push({
        id: `low-${row.key}`,
        productKey: row.key,
        productName: row.name,
        menuProductId: row.menuProductId,
        kind: "low_demand",
        severity: "low",
        currentPrice: row.averagePrice,
        proposedPrice: null,
        why: "low-demand-one-period",
        evidence: [`qty:${row.quantity}`, `median:${median}`],
        caveats: ["do-not-remove-from-one-report"],
      });
    }
  }
  return cards;
}
