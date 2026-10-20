import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
if (privateKey.startsWith("\"")) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, "\n");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
initializeApp({
  credential: cert({
    projectId,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey,
  }),
});
const db = getFirestore();
console.log("project", projectId);
const names = [
  "ingredients",
  "ingredientCategories",
  "dishRecipes",
  "productCostLinks",
  "ingredientPriceHistory",
  "suppliers",
  "supplierOffers",
  "supplierItemMaps",
  "purchasePriceRecords",
  "purchaseInvoices",
  "inventoryMovements",
  "inventoryBalances",
  "posImports",
  "posProductMaps",
  "posZReports",
  "breakEvenFixedCosts",
  "costingSettings",
  "products",
  "categories",
  "orders",
  "payments",
  "customers",
  "users",
];
for (const name of names) {
  const snap = await db.collection(name).count().get();
  console.log(`${name}: ${snap.data().count}`);
}
