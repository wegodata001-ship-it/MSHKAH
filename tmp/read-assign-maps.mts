import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const db = getAdminDb();
const invoice = await db.collection(COLLECTIONS.purchaseInvoices).doc("qa-assign-1910").get();
const data = invoice.data() ?? {};
console.log("supplier", data.supplierId, "lines", (data.lines ?? []).map((line: { key?: string; sku?: string; productId?: string; rawName?: string; originalDescription?: string }) => ({
  key: line.key,
  sku: line.sku,
  productId: line.productId,
  rawName: line.rawName,
  original: line.originalDescription,
})));
const maps = await db.collection(COLLECTIONS.supplierItemMaps).where("supplierId", "==", "qa-supplier-1910").get();
console.log("maps", maps.size, maps.docs.map((doc) => doc.data()));
const { matchInventoryProduct } = await import("../src/lib/inventory/invoice-smart-match");
const ingredients = [
  { id: "qa-existing-1910", name: "בדיקת קיים 1910", purchasePrice: 0, purchaseQuantity: 1, purchaseUnit: "unit", baseUnit: "unit", costPerBaseUnit: 0, active: true, createdAt: "", updatedAt: "" },
  { id: "vrR75TC9eVUBhWg48f2N", name: "בדיקת מוצר חדש 1910", purchasePrice: 0, purchaseQuantity: 1, purchaseUnit: "unit", baseUnit: "unit", costPerBaseUnit: 0, active: true, createdAt: "", updatedAt: "" },
];
const mapRows = maps.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
const same = matchInventoryProduct({ name: "בדיקת מוצר חדש", sku: "QA-SKU-1910", unit: "unit", quantity: 9 }, ingredients as never, mapRows as never, "qa-supplier-1910");
const conflict = matchInventoryProduct({ name: "בדיקת מוצר חדש", sku: "QA-SKU-1910", unit: "kg", quantity: 9 }, ingredients as never, mapRows as never, "qa-supplier-1910");
console.log("same", same.kind, same.item?.id, same.packConflict);
console.log("conflict", conflict.kind, conflict.item?.id, conflict.packConflict);
