import { existsSync, readdirSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

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
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});
const db = getFirestore();
const names = [
  "purchaseInvoices",
  "archivePurchaseInvoices",
  "posZReports",
  "archivePosZReports",
  "inventoryMovements",
  "archiveInventoryMovements",
  "suppliers",
  "ingredients",
  "inventoryBalances",
  "cashFlowEntries",
  "dishRecipes",
  "breakEvenFixedCosts",
  "supplierOffers",
  "posImports",
  "products",
  "categories",
  "orders",
  "payments",
  "customers",
  "users",
  "settings",
  "inventory_links",
  "modifier_groups",
  "productChangeHistory",
];
console.log("project", projectId);
for (const name of names) {
  const snap = await db.collection(name).count().get();
  console.log(`${name}: ${snap.data().count}`);
}
const products = await db.collection("products").get();
let nullCost = 0;
let zeroCost = 0;
let priced = 0;
for (const doc of products.docs) {
  const data = doc.data();
  if (data.cost == null) nullCost += 1;
  else if (Number(data.cost) === 0) zeroCost += 1;
  if (data.price != null) priced += 1;
}
const archive = await db.collection("archivePurchaseInvoices").limit(3).get();
const flags = archive.docs.map((doc) => ({
  id: doc.id,
  blocked: doc.data().repostBlocked === true,
  hidden: doc.data().excludeFromActiveWork === true,
}));
const bucket = getStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const [files] = await bucket.getFiles({ prefix: "invoice-files/" });
const [zfiles] = await bucket.getFiles({ prefix: "pos-z-reports/" });
console.log(JSON.stringify({
  nullCost,
  zeroCost,
  priced,
  products: products.size,
  flags,
  invoiceFiles: files.filter((file) => !file.name.endsWith("/")).length,
  zFiles: zfiles.filter((file) => !file.name.endsWith("/")).length,
  originalBackup: existsSync("backups/finance-procurement-2026-10-20/manifest.json"),
  originalJson: readdirSync("backups/finance-procurement-2026-10-20").filter((name) => name.endsWith(".json")).length,
}, null, 2));
