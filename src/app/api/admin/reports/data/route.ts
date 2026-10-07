import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import type {
  InventoryMovement,
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
  SupplierOffer,
} from "@/lib/inventory/types";
import {
  applyInventoryScope,
  buildBlankRows,
  buildCountRows,
  buildInventoryRows,
  buildPriceCompare,
  buildPurchaseRows,
  buildReportKpis,
  classifyExceptions,
  countTotals,
  DEFAULT_VARIANCE_PERCENT,
  groupPurchasesBySupplier,
  purchaseSummary,
} from "@/lib/reports/compute";
import { reportOrientation } from "@/lib/reports/pdf/filename";
import type { ExceptionKind, ReportFilters, ReportScope, ReportType, StockCount } from "@/lib/reports/types";

export const runtime = "nodejs";

function asIngredient(id: string, data: FirebaseFirestore.DocumentData): CostingIngredient {
  return {
    id,
    name: String(data.name ?? ""),
    category: data.category ? String(data.category) : undefined,
    purchasePrice: Number(data.purchasePrice ?? 0),
    purchaseQuantity: Number(data.purchaseQuantity ?? 1),
    purchaseUnit: (data.purchaseUnit as PurchaseUnit) || "kg",
    baseUnit: (data.baseUnit as CostingIngredient["baseUnit"]) || "g",
    costPerBaseUnit: Number(data.costPerBaseUnit ?? 0),
    supplier: data.supplier ? String(data.supplier) : undefined,
    minStock: data.minStock != null ? Number(data.minStock) : undefined,
    recommendedStock: data.recommendedStock != null ? Number(data.recommendedStock) : undefined,
    lastSupplierId: data.lastSupplierId ? String(data.lastSupplierId) : undefined,
    active: data.active !== false,
    createdAt: "",
    updatedAt: "",
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const url = request.nextUrl;
  const rawType = url.searchParams.get("type") || "home";
  const type = (rawType === "home" ? "inventory" : rawType) as ReportType;
  const isHome = rawType === "home";
  const scope = (url.searchParams.get("scope") as ReportScope | null) || undefined;
  const filters: ReportFilters = {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    category: url.searchParams.get("category") || undefined,
    supplierId: url.searchParams.get("supplierId") || undefined,
    productId: url.searchParams.get("productId") || undefined,
    status: (url.searchParams.get("status") as ExceptionKind | "all") || undefined,
    scope,
    shift: url.searchParams.get("shift") || undefined,
    search: url.searchParams.get("search") || undefined,
  };

  const db = getAdminDb();
  const [ingredientsSnap, movementsSnap, offersSnap, recordsSnap, suppliersSnap, invoicesSnap, countsSnap, settingsSnap, runsSnap] =
    await Promise.all([
      db.collection(COLLECTIONS.ingredients).limit(800).get(),
      db.collection(COLLECTIONS.inventoryMovements).limit(2000).get(),
      db.collection(COLLECTIONS.supplierOffers).limit(800).get(),
      db.collection(COLLECTIONS.purchasePriceRecords).limit(2000).get(),
      db.collection(COLLECTIONS.suppliers).limit(400).get(),
      db.collection(COLLECTIONS.purchaseInvoices).limit(400).get(),
      db.collection(COLLECTIONS.stockCounts).limit(800).get(),
      db.collection(COLLECTIONS.costingSettings).doc("default").get(),
      db.collection(COLLECTIONS.reportRuns).limit(20).get(),
    ]);

  const products = ingredientsSnap.docs.map((doc) => asIngredient(doc.id, doc.data()));
  const movements = movementsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as InventoryMovement);
  const offers = offersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SupplierOffer);
  const records = recordsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PurchasePriceRecord);
  const suppliers = suppliersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Supplier);
  const invoices = invoicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as PurchaseInvoice);
  const counts = countsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as StockCount);
  const variance = Number(settingsSnap.data()?.variancePercent ?? DEFAULT_VARIANCE_PERCENT);

  const inventoryAll = buildInventoryRows(products, movements, offers, records, suppliers, { ...filters, scope: undefined });
  const inventory = applyInventoryScope(inventoryAll, filters.scope);
  const kpis = buildReportKpis(isHome ? inventoryAll : inventory, records, movements);
  const exceptions = classifyExceptions(inventoryAll, counts, variance).filter(
    (row) => !filters.status || filters.status === "all" || row.kind === filters.status
  );
  const purchaseRows = type === "purchases" || isHome ? buildPurchaseRows(records, products, suppliers, invoices, filters) : [];
  const countRows = type === "count-consumption" ? buildCountRows(inventory, counts, filters, variance) : undefined;

  const payload = {
    type,
    generatedAt: new Date().toISOString(),
    periodFrom: filters.from,
    periodTo: filters.to,
    orientation: reportOrientation(type),
    branchName: "Mishkat Cafe",
    kpis,
    categories: [...new Set(products.map((item) => item.category).filter(Boolean))] as string[],
    suppliers: suppliers.map((item) => ({ id: item.id, name: item.name, phone: item.phone, taxId: item.taxId })),
    products: products.map((item) => ({ id: item.id, name: item.name })),
    runs: runsSnap.docs
      .map((doc) => {
        const data = doc.data() as { type?: string; periodFrom?: string; periodTo?: string; generatedAt?: string; generatedByName?: string };
        return {
          id: doc.id,
          type: (data.type ?? "inventory") as ReportType,
          periodFrom: data.periodFrom,
          periodTo: data.periodTo,
          generatedAt: data.generatedAt ?? "",
          generatedByName: data.generatedByName,
        };
      })
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .slice(0, 8),
    inventory: type === "inventory" || isHome ? (isHome ? inventoryAll : inventory) : undefined,
    exceptions: type === "exceptions" || isHome ? exceptions : undefined,
    blank: type === "blank-count" ? buildBlankRows(products, movements, filters) : undefined,
    counts: countRows,
    countTotals: countRows ? countTotals(countRows) : undefined,
    purchases: type === "purchases" ? purchaseRows : undefined,
    purchaseGroups: type === "purchases" ? groupPurchasesBySupplier(purchaseRows, suppliers) : undefined,
    purchaseSummary: type === "purchases" ? purchaseSummary(purchaseRows) : undefined,
    priceCompare: type === "supplier-compare" || type === "purchases"
      ? buildPriceCompare(records, products, suppliers, filters)
      : undefined,
  };

  return Response.json(payload);
}
