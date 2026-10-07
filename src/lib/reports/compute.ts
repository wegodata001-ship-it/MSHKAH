import type { CostingIngredient } from "@/lib/costing/types";
import { PURCHASE_UNITS } from "@/lib/costing/units";
import {
  currentStockBase,
  latestPurchase,
  movementSignedBase,
  offerNormalizedNet,
  reorderQty,
} from "@/lib/inventory/stock";
import type {
  InventoryMovement,
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
  SupplierOffer,
} from "@/lib/inventory/types";
import { inDateRange, monthBounds } from "@/lib/reports/format";
import type {
  BlankCountRow,
  CountConsumptionRow,
  CountTotals,
  ExceptionKind,
  ExceptionReportRow,
  InventoryReportRow,
  InventoryStatus,
  InventorySupplierLine,
  PurchaseReportRow,
  PurchaseSummary,
  PurchaseSupplierGroup,
  ReportFilters,
  ReportKpis,
  ReportScope,
  StockCount,
  SupplierPriceCompare,
  VarianceTone,
} from "@/lib/reports/types";

export const DEFAULT_VARIANCE_PERCENT = 5;
export const DEFAULT_NEAR_MIN_RATIO = 0.2;
export const STALE_PURCHASE_DAYS = 90;

function movementDay(row: InventoryMovement): string {
  return (row.receivedAt || row.createdAt || "").slice(0, 10);
}

function matchesSearch(haystack: string, search?: string): boolean {
  if (!search?.trim()) return true;
  return haystack.toLowerCase().includes(search.trim().toLowerCase());
}

function inPeriod(row: InventoryMovement, filters: ReportFilters): boolean {
  return inDateRange(movementDay(row), filters.from, filters.to);
}

export function openingBase(movements: InventoryMovement[], productId: string, from?: string): number {
  return movements
    .filter((row) => row.productId === productId)
    .filter((row) => (from ? movementDay(row) < from : row.type === "OPENING"))
    .reduce((sum, row) => sum + movementSignedBase(row), 0);
}

export function incomingBase(movements: InventoryMovement[], productId: string, filters: ReportFilters): number {
  return movements
    .filter((row) => row.productId === productId && row.type === "PURCHASE_IN" && inPeriod(row, filters))
    .reduce((sum, row) => sum + Math.abs(row.quantityBase), 0);
}

export function consumptionBase(movements: InventoryMovement[], productId: string, filters: ReportFilters): number {
  return movements
    .filter((row) => row.productId === productId && row.type === "SALE_OUT" && inPeriod(row, filters))
    .reduce((sum, row) => sum + Math.abs(row.quantityBase), 0);
}

export function adjustmentBase(movements: InventoryMovement[], productId: string, filters: ReportFilters): number {
  return movements
    .filter((row) => row.productId === productId && (row.type === "ADJUSTMENT" || row.type === "REVERSAL") && inPeriod(row, filters))
    .reduce((sum, row) => sum + movementSignedBase(row), 0);
}

function lastSupplierName(
  product: CostingIngredient,
  offers: SupplierOffer[],
  suppliers: Supplier[]
): string | null {
  const offer = offers
    .filter((item) => item.productId === product.id)
    .slice()
    .sort((a, b) => (b.lastPurchaseDate ?? "").localeCompare(a.lastPurchaseDate ?? ""))[0];
  const id = product.lastSupplierId || offer?.supplierId;
  if (!id) return product.supplier || null;
  return suppliers.find((item) => item.id === id)?.name ?? product.supplier ?? null;
}

export function hasSupplier(productId: string, offers: SupplierOffer[], product?: CostingIngredient): boolean {
  if (offers.some((offer) => offer.productId === productId)) return true;
  return Boolean(product?.supplier?.trim() || product?.lastSupplierId);
}

export function isInvalidUnit(product: CostingIngredient): boolean {
  if (!PURCHASE_UNITS.includes(product.purchaseUnit)) return true;
  if (!product.baseUnit) return true;
  return !(product.purchaseQuantity > 0);
}

export function inventoryStatus(row: Pick<
  InventoryReportRow,
  "current" | "minStock" | "missingSupplier" | "lastPrice" | "invalidUnit"
>): InventoryStatus {
  if (row.current != null && row.current < 0) return "needs-attention";
  if (row.current === 0) return "out";
  if (row.minStock != null && row.current != null && row.current < row.minStock) return "low";
  if (row.missingSupplier) return "no-supplier";
  if (row.lastPrice == null || row.invalidUnit) return "needs-attention";
  return "ok";
}

export function applyInventoryScope(rows: InventoryReportRow[], scope?: ReportScope): InventoryReportRow[] {
  if (!scope || scope === "all") return rows;
  if (scope === "exceptions") return rows.filter((row) => row.status !== "ok");
  if (scope === "no-supplier") return rows.filter((row) => row.missingSupplier);
  return rows.filter((row) => (row.toOrder ?? 0) > 0);
}

export function buildSupplierLines(
  productId: string,
  offers: SupplierOffer[],
  records: PurchasePriceRecord[],
  suppliers: Supplier[]
): InventorySupplierLine[] {
  const names = new Map(suppliers.map((item) => [item.id, item.name]));
  const byId = new Map<string, InventorySupplierLine>();

  for (const offer of offers.filter((item) => item.productId === productId && item.active !== false)) {
    const price = offerNormalizedNet(offer) ?? offer.priceBeforeVat ?? offer.currentPrice ?? offer.lastPurchasePrice ?? null;
    byId.set(offer.supplierId, {
      supplierId: offer.supplierId,
      supplierName: names.get(offer.supplierId) ?? offer.supplierId,
      price,
      lastPurchaseDate: offer.lastPurchaseDate ?? offer.lastPurchasedAt,
    });
  }

  for (const record of records.filter((item) => item.productId === productId && item.supplierId)) {
    const id = record.supplierId!;
    const existing = byId.get(id);
    const date = record.purchaseDate;
    if (!existing || (existing.lastPurchaseDate ?? "") < date) {
      byId.set(id, {
        supplierId: id,
        supplierName: names.get(id) ?? existing?.supplierName ?? id,
        price: record.unitCost > 0 ? record.unitCost : existing?.price ?? null,
        lastPurchaseDate: date,
      });
    }
  }

  const lines = [...byId.values()];
  const priced = lines.map((line) => line.price).filter((n): n is number => n != null && n > 0);
  const cheapest = priced.length ? Math.min(...priced) : null;
  return lines
    .map((line) => ({ ...line, cheapest: cheapest != null && line.price === cheapest }))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

function daysBetween(iso: string, now: Date): number {
  const then = new Date(iso.slice(0, 10));
  if (Number.isNaN(then.getTime())) return 0;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

export function buildInventoryRows(
  products: CostingIngredient[],
  movements: InventoryMovement[],
  offers: SupplierOffer[],
  records: PurchasePriceRecord[],
  suppliers: Supplier[],
  filters: ReportFilters
): InventoryReportRow[] {
  const rows = products
    .filter((item) => item.active !== false)
    .filter((item) => !filters.category || (item.category || "") === filters.category)
    .filter((item) => !filters.productId || item.id === filters.productId)
    .filter((item) => matchesSearch(`${item.name} ${item.category ?? ""}`, filters.search))
    .flatMap((item): InventoryReportRow[] => {
      const last = latestPurchase(records, item.id);
      const current = currentStockBase(movements, item.id);
      const lastPrice = last?.unitCost ?? (item.costPerBaseUnit > 0 ? item.costPerBaseUnit : null);
      const missingSupplier = !hasSupplier(item.id, offers, item);
      if (filters.supplierId) {
        const linked = offers.some((offer) => offer.productId === item.id && offer.supplierId === filters.supplierId);
        if (!linked && item.lastSupplierId !== filters.supplierId && last?.supplierId !== filters.supplierId) return [];
      }
      const supplierLines = buildSupplierLines(item.id, offers, records, suppliers);
      const cheapest = supplierLines.find((line) => line.cheapest)?.price ?? null;
      const row: InventoryReportRow = {
        productId: item.id,
        category: item.category || "—",
        name: item.name,
        unit: item.purchaseUnit,
        opening: openingBase(movements, item.id, filters.from),
        incoming: incomingBase(movements, item.id, filters),
        consumption: consumptionBase(movements, item.id, filters),
        adjustments: adjustmentBase(movements, item.id, filters),
        current,
        minStock: item.minStock ?? null,
        recommended: item.recommendedStock ?? null,
        toOrder: item.recommendedStock != null || item.minStock != null
          ? reorderQty(current, item.recommendedStock ?? item.minStock ?? 0)
          : null,
        lastSupplier: lastSupplierName(item, offers, suppliers),
        lastPrice,
        normalizedPrice: lastPrice ?? cheapest,
        lastPurchaseDate: last?.purchaseDate ?? null,
        stockValue: lastPrice != null ? current * lastPrice : null,
        missingSupplier,
        invalidUnit: isInvalidUnit(item),
        status: "ok",
        supplierLines,
      };
      row.status = inventoryStatus(row);
      return [row];
    });
  return rows;
}

export function classifyExceptions(
  rows: InventoryReportRow[],
  counts: StockCount[],
  variancePercent = DEFAULT_VARIANCE_PERCENT,
  nearRatio = DEFAULT_NEAR_MIN_RATIO,
  now = new Date()
): ExceptionReportRow[] {
  const out: ExceptionReportRow[] = [];
  for (const row of rows) {
    const current = row.current;
    const min = row.minStock;
    const count = counts
      .filter((item) => item.productId === row.productId)
      .slice()
      .sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0];

    const push = (kind: ExceptionKind, gap: number | null, action: string) => {
      out.push({
        productId: row.productId,
        name: row.name,
        kind,
        current,
        minStock: min,
        toOrder: row.toOrder,
        gap,
        supplier: row.lastSupplier,
        lastPrice: row.lastPrice,
        action,
      });
    };

    if (current != null && current < 0) {
      push("negative", current, "adjust");
    } else if (current === 0) {
      push("out", min != null ? -min : 0, "order");
    } else if (min != null && current != null && current < min) {
      push("below-min", current - min, "order");
    } else if (min != null && current != null && current >= min && current <= min * (1 + nearRatio)) {
      push("near-min", current - min, "watch");
    }
    if (row.missingSupplier) push("no-supplier", null, "link-supplier");
    if (row.lastPrice == null) push("no-price", null, "record-price");
    if (row.invalidUnit) push("bad-unit", null, "fix-unit");
    if (row.lastPurchaseDate && daysBetween(row.lastPurchaseDate, now) >= STALE_PURCHASE_DAYS) {
      push("stale", null, "order");
    } else if (!row.lastPurchaseDate && current != null && current > 0) {
      push("stale", null, "record-price");
    }
    if (count && current != null) {
      const expected = current;
      const gap = count.quantityBase - expected;
      const denom = expected === 0 ? count.quantityBase || 1 : expected;
      const deviation = (gap / denom) * 100;
      if (Math.abs(deviation) >= variancePercent) {
        push("count-gap", gap, "recount");
      }
    }
  }
  return out;
}

export function varianceTone(deviation: number | null, threshold = DEFAULT_VARIANCE_PERCENT): VarianceTone {
  if (deviation == null || !Number.isFinite(deviation)) return "none";
  const abs = Math.abs(deviation);
  if (abs < threshold) return "ok";
  if (abs < threshold * 2) return "watch";
  return "critical";
}

export function buildCountRows(
  inventory: InventoryReportRow[],
  counts: StockCount[],
  filters: ReportFilters,
  threshold = DEFAULT_VARIANCE_PERCENT
): CountConsumptionRow[] {
  return inventory
    .filter((row) => !filters.productId || row.productId === filters.productId)
    .map((row) => {
      const count = counts
        .filter((item) => item.productId === row.productId)
        .filter((item) => inDateRange(item.countedAt, filters.from, filters.to))
        .filter((item) => !filters.shift || item.shift === filters.shift)
        .slice()
        .sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0];
      const opening = row.opening;
      const incoming = row.incoming;
      const otherIn = row.adjustments;
      const sales = row.consumption;
      const theoretical = row.consumption;
      const expected =
        opening != null && incoming != null && theoretical != null
          ? opening + incoming + (row.adjustments ?? 0) - theoretical
          : null;
      const actual = count ? count.quantityBase : null;
      const gap = actual != null && expected != null ? actual - expected : null;
      const deviation = gap != null && expected != null && expected !== 0 ? (gap / expected) * 100 : null;
      return {
        productId: row.productId,
        name: row.name,
        opening,
        incoming,
        otherIn,
        sales,
        theoretical,
        counted: actual,
        expected,
        actual,
        gap,
        gapCost: gap != null && row.lastPrice != null ? gap * row.lastPrice : null,
        deviation,
        tone: actual == null ? "none" : varianceTone(deviation, threshold),
      };
    });
}

export function countTotals(rows: CountConsumptionRow[]): CountTotals {
  if (!rows.length) {
    return { consumption: null, gapPositive: null, gapNegative: null, gapValue: null };
  }
  const consumption = rows.reduce((sum, row) => sum + (row.sales ?? row.theoretical ?? 0), 0);
  const gapPositive = rows.reduce((sum, row) => sum + Math.max(0, row.gap ?? 0), 0);
  const gapNegative = rows.reduce((sum, row) => sum + Math.min(0, row.gap ?? 0), 0);
  const gapCosts = rows.map((row) => row.gapCost).filter((n): n is number => n != null);
  return {
    consumption,
    gapPositive,
    gapNegative,
    gapValue: gapCosts.length ? gapCosts.reduce((sum, n) => sum + n, 0) : null,
  };
}

export function buildBlankRows(
  products: CostingIngredient[],
  movements: InventoryMovement[],
  filters: ReportFilters
): BlankCountRow[] {
  return products
    .filter((item) => item.active !== false)
    .filter((item) => !filters.category || (item.category || "") === filters.category)
    .filter((item) => matchesSearch(`${item.name} ${item.category ?? ""}`, filters.search))
    .map((item) => ({
      productId: item.id,
      category: item.category || "—",
      name: item.name,
      unit: item.purchaseUnit,
      systemQty: currentStockBase(movements, item.id),
    }));
}

export function buildPurchaseRows(
  records: PurchasePriceRecord[],
  products: CostingIngredient[],
  suppliers: Supplier[],
  invoices: PurchaseInvoice[],
  filters: ReportFilters
): PurchaseReportRow[] {
  return records
    .filter((row) => inDateRange(row.purchaseDate, filters.from, filters.to))
    .filter((row) => !filters.supplierId || row.supplierId === filters.supplierId)
    .filter((row) => !filters.productId || row.productId === filters.productId)
    .flatMap((row): PurchaseReportRow[] => {
      const product = products.find((item) => item.id === row.productId);
      if (filters.category && (product?.category || "") !== filters.category) return [];
      const supplier = suppliers.find((item) => item.id === row.supplierId);
      const supplierName = supplier?.name ?? "—";
      const invoice = invoices.find((item) => item.id === row.invoiceId);
      const haystack = `${product?.name ?? ""} ${supplierName} ${invoice?.invoiceNumber ?? ""}`;
      if (!matchesSearch(haystack, filters.search)) return [];
      const qty = row.quantity > 0 ? row.quantity : null;
      return [{
        date: row.purchaseDate,
        supplierId: row.supplierId,
        supplier: supplierName,
        invoice: invoice?.invoiceNumber || row.invoiceId || "—",
        product: product?.name || row.productId,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitCost,
        netUnitPrice: qty ? row.priceBeforeVat / qty : null,
        vatUnit: qty ? row.vatAmount / qty : null,
        grossUnitPrice: qty ? row.priceIncludingVat / qty : null,
        beforeVat: row.priceBeforeVat,
        vat: row.vatAmount,
        includingVat: row.priceIncludingVat,
      }];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function purchaseSummary(rows: PurchaseReportRow[]): PurchaseSummary {
  if (!rows.length) {
    return { totalIncluding: null, totalBefore: null, totalVat: null, invoiceCount: null, productCount: null };
  }
  return {
    totalIncluding: rows.reduce((sum, row) => sum + (row.includingVat ?? 0), 0),
    totalBefore: rows.reduce((sum, row) => sum + (row.beforeVat ?? 0), 0),
    totalVat: rows.reduce((sum, row) => sum + (row.vat ?? 0), 0),
    invoiceCount: new Set(rows.map((row) => row.invoice)).size,
    productCount: new Set(rows.map((row) => row.product)).size,
  };
}

export function groupPurchasesBySupplier(
  rows: PurchaseReportRow[],
  suppliers: Array<{ id: string; name: string; phone?: string; taxId?: string }>
): PurchaseSupplierGroup[] {
  const groups = new Map<string, PurchaseSupplierGroup>();
  for (const row of rows) {
    const key = row.supplierId || row.supplier;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.totalBefore += row.beforeVat ?? 0;
      existing.totalVat += row.vat ?? 0;
      existing.totalIncluding += row.includingVat ?? 0;
      existing.invoiceCount = new Set(existing.rows.map((item) => item.invoice)).size;
      continue;
    }
    const supplier = suppliers.find((item) => item.id === row.supplierId || item.name === row.supplier);
    groups.set(key, {
      supplierId: row.supplierId || key,
      supplierName: row.supplier,
      phone: supplier?.phone,
      taxId: supplier?.taxId,
      invoiceCount: 1,
      totalBefore: row.beforeVat ?? 0,
      totalVat: row.vat ?? 0,
      totalIncluding: row.includingVat ?? 0,
      rows: [row],
    });
  }
  return [...groups.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName, "he"));
}

export function buildPriceCompare(
  records: PurchasePriceRecord[],
  products: CostingIngredient[],
  suppliers: Supplier[],
  filters: ReportFilters
): SupplierPriceCompare[] {
  const byProduct = new Map<string, PurchasePriceRecord[]>();
  for (const row of records) {
    if (!inDateRange(row.purchaseDate, filters.from, filters.to)) continue;
    if (filters.productId && row.productId !== filters.productId) continue;
    const list = byProduct.get(row.productId) ?? [];
    list.push(row);
    byProduct.set(row.productId, list);
  }
  return [...byProduct.entries()].flatMap(([productId, list]): SupplierPriceCompare[] => {
    const product = products.find((item) => item.id === productId);
    if (!product) return [];
    if (filters.category && (product.category || "") !== filters.category) return [];
    const latestBySupplier = new Map<string, PurchasePriceRecord>();
    for (const row of list.slice().sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))) {
      if (row.supplierId) latestBySupplier.set(row.supplierId, row);
    }
    const offers = [...latestBySupplier.entries()].map(([supplierId, row]) => ({
      supplierId,
      supplierName: suppliers.find((item) => item.id === supplierId)?.name ?? supplierId,
      packageQty: row.packageQuantity,
      unit: row.unit,
      price: row.priceBeforeVat,
      unitCost: row.unitCost,
      lastDate: row.purchaseDate,
    }));
    if (offers.length === 0) return [];
    if (filters.supplierId && !offers.some((offer) => offer.supplierId === filters.supplierId)) return [];
    const costs = offers.map((offer) => offer.unitCost).filter((n) => n > 0);
    if (!costs.length) return [];
    const cheapest = Math.min(...costs);
    const highest = Math.max(...costs);
    return [{
      productId,
      name: product.name,
      offers,
      latest: offers.slice().sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""))[0]?.unitCost ?? null,
      cheapest,
      highest,
      average: costs.reduce((sum, n) => sum + n, 0) / costs.length,
      cheapestSupplierId: offers.find((offer) => offer.unitCost === cheapest)?.supplierId,
      savings: highest > cheapest ? highest - cheapest : null,
      savingsPct: highest > 0 && highest > cheapest ? ((highest - cheapest) / highest) * 100 : null,
    }];
  });
}

export function buildReportKpis(
  inventory: InventoryReportRow[],
  records: PurchasePriceRecord[],
  movements: InventoryMovement[],
  now = new Date()
): ReportKpis {
  const month = monthBounds(now);
  const monthPurchases = records.filter((row) => inDateRange(row.purchaseDate, month.from, month.to));
  const monthOut = movements.filter((row) => row.type === "SALE_OUT" && inDateRange(movementDay(row), month.from, month.to));
  const stockValues = inventory.map((row) => row.stockValue).filter((n): n is number => n != null);
  const consumptionValues = monthOut
    .map((row) => (row.unitCost != null ? Math.abs(row.quantityBase) * row.unitCost : null))
    .filter((n): n is number => n != null);
  return {
    itemCount: inventory.length ? inventory.length : null,
    stockValue: stockValues.length ? stockValues.reduce((sum, n) => sum + n, 0) : null,
    inStockCount: inventory.length ? inventory.filter((row) => (row.current ?? 0) > 0).length : null,
    belowMinCount: inventory.some((row) => row.minStock != null)
      ? inventory.filter((row) => row.minStock != null && row.current != null && row.current < row.minStock).length
      : inventory.length
        ? 0
        : null,
    missingSupplierCount: inventory.length ? inventory.filter((row) => row.missingSupplier).length : null,
    monthPurchases: monthPurchases.length ? monthPurchases.reduce((sum, row) => sum + row.priceIncludingVat, 0) : null,
    monthConsumption: consumptionValues.length ? consumptionValues.reduce((sum, n) => sum + n, 0) : monthOut.length ? null : null,
  };
}
