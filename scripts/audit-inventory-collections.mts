import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const NAMES = [
  COLLECTIONS.ingredients,
  COLLECTIONS.dishRecipes,
  COLLECTIONS.ingredientPriceHistory,
  COLLECTIONS.costingSettings,
  COLLECTIONS.costingSnapshots,
  COLLECTIONS.products,
  COLLECTIONS.orders,
  COLLECTIONS.payments,
  COLLECTIONS.inventoryLinks,
  "suppliers",
  "supplierOffers",
  "purchaseInvoices",
  "purchasePriceRecords",
  "inventoryMovements",
  "posImports",
  "posProductMaps",
  "purchaseOrders",
  "dailyCounts",
];

async function main() {
  const db = getAdminDb();
  const counts: Record<string, number> = {};
  for (const name of NAMES) {
    try {
      const snap = await db.collection(name).limit(500).get();
      counts[name] = snap.size;
    } catch {
      counts[name] = -1;
    }
  }
  console.log(JSON.stringify(counts, null, 2));
}

void main();
