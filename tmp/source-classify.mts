import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { buildProductSource } from "../src/lib/inventory/product-source";
import type { CostingIngredient } from "../src/lib/costing/types";
import type { InventoryMovement, PurchaseInvoice, Supplier, SupplierItemMap } from "../src/lib/inventory/types";

function iso(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return String(value);
}

async function main() {
  const db = getAdminDb();
  const [ingredientsSnap, invoicesSnap, movementsSnap, mapsSnap, suppliersSnap] = await Promise.all([
    db.collection(COLLECTIONS.ingredients).get(),
    db.collection(COLLECTIONS.purchaseInvoices).get(),
    db.collection(COLLECTIONS.inventoryMovements).get(),
    db.collection(COLLECTIONS.supplierItemMaps).get(),
    db.collection(COLLECTIONS.suppliers).get(),
  ]);
  const ingredients = ingredientsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: iso(doc.get("createdAt")), updatedAt: iso(doc.get("updatedAt")) }) as CostingIngredient);
  const invoices = invoicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: iso(doc.get("createdAt")) }) as PurchaseInvoice);
  const movements = movementsSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      receivedAt: iso(data.receivedAt) || iso(data.createdAt),
      createdAt: iso(data.createdAt),
    } as InventoryMovement;
  });
  const maps = mapsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SupplierItemMap);
  const suppliers = suppliersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Supplier);
  const counts: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  for (const item of ingredients.filter((row) => row.active !== false)) {
    const source = buildProductSource({ product: item, invoices, movements, maps, suppliers });
    const key = `${source.summary.code}${source.intakes.length > 1 ? ":many" : ""}`;
    counts[key] = (counts[key] ?? 0) + 1;
    const bucket = samples[key] ?? [];
    if (bucket.length < 3) {
      const latest = source.intakes[0];
      bucket.push(
        `${item.name} | create=${source.creation.kind} | intakes=${source.intakes.length} | ${latest ? `${latest.kind} ${latest.invoiceNumber ?? ""} ${latest.supplierName ?? ""} qty=${latest.quantity}` : "no-intake"}`
      );
    }
    samples[key] = bucket;
  }
  console.log(JSON.stringify({ ingredients: ingredients.length, invoices: invoices.length, movements: movements.length, counts, samples }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
