import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mapStoredInvoice } from "@/lib/inventory/invoice-removal-admin";
import type { ReportSource } from "@/lib/reports/export/documents";

function plain<T>(id: string, data: Record<string, unknown>): T {
  const json = JSON.stringify({ id, ...data }, (_key, value) => {
    if (value && typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
      try {
        return (value as { toDate: () => Date }).toDate().toISOString();
      } catch {
        return null;
      }
    }
    return value === undefined ? null : value;
  });
  return JSON.parse(json) as T;
}

async function all<T>(db: Firestore, name: string): Promise<T[]> {
  const snap = await db.collection(name).get();
  return snap.docs.map((doc) => plain<T>(doc.id, doc.data() as Record<string, unknown>));
}

export async function loadReportSource(db: Firestore): Promise<ReportSource> {
  const [active, archived, openingSnap] = await Promise.all([
    db.collection(COLLECTIONS.purchaseInvoices).get(),
    db.collection(COLLECTIONS.archivePurchaseInvoices).get(),
    db.collection(COLLECTIONS.cashFlowSettings).doc("default").get(),
  ]);
  const invoices = [
    ...active.docs.map((doc) => mapStoredInvoice(doc.id, doc.data() as Record<string, unknown>)),
    ...archived.docs.map((doc) => mapStoredInvoice(doc.id, doc.data() as Record<string, unknown>)),
  ];
  const [movements, archiveMovements, payments, suppliers, ingredients, offers, prices, recipes, products, categories, zReports, archiveZReports, cashEntries, fixedCosts, variableCosts, orders] = await Promise.all([
    all<ReportSource["movements"][number]>(db, COLLECTIONS.inventoryMovements),
    all<ReportSource["movements"][number]>(db, COLLECTIONS.archiveInventoryMovements),
    all<ReportSource["payments"][number]>(db, COLLECTIONS.supplierPayments),
    all<ReportSource["suppliers"][number]>(db, COLLECTIONS.suppliers),
    all<ReportSource["ingredients"][number]>(db, COLLECTIONS.ingredients),
    all<ReportSource["offers"][number]>(db, COLLECTIONS.supplierOffers),
    all<ReportSource["prices"][number]>(db, COLLECTIONS.purchasePriceRecords),
    all<ReportSource["recipes"][number]>(db, COLLECTIONS.dishRecipes),
    all<ReportSource["products"][number]>(db, COLLECTIONS.products),
    all<ReportSource["categories"][number]>(db, COLLECTIONS.categories),
    all<ReportSource["zReports"][number]>(db, COLLECTIONS.posZReports),
    all<ReportSource["zReports"][number]>(db, "archivePosZReports"),
    all<ReportSource["cashEntries"][number]>(db, COLLECTIONS.cashFlowEntries),
    all<ReportSource["fixedCosts"][number]>(db, COLLECTIONS.breakEvenFixedCosts),
    all<ReportSource["variableCosts"][number]>(db, COLLECTIONS.breakEvenVariableCosts),
    all<ReportSource["orders"][number]>(db, COLLECTIONS.orders),
  ]);
  const openingData = openingSnap.exists ? openingSnap.data() : null;
  const amount = typeof openingData?.amount === "number" ? openingData.amount : null;
  const date = typeof openingData?.date === "string" ? openingData.date : null;
  return {
    invoices,
    movements: [...movements, ...archiveMovements],
    payments,
    suppliers,
    ingredients,
    offers,
    prices,
    recipes,
    products,
    categories,
    zReports: [...zReports, ...archiveZReports],
    cashEntries,
    cashOpening: amount != null && date ? { amount, date } : null,
    fixedCosts,
    variableCosts,
    orders,
  };
}
