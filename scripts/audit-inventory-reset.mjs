/**
 * Read-only audit and local backup for the inventory/costing reset.
 * Does not write to Firestore.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTIONS = [
  "ingredients",
  "ingredientCategories",
  "dishRecipes",
  "productCostLinks",
  "ingredientPriceHistory",
  "costingSettings",
  "costingSnapshots",
  "costingImportHistory",
  "breakEvenFixedCosts",
  "breakEvenVariableCosts",
  "breakEvenSettings",
  "breakEvenSnapshots",
  "cashFlowEntries",
  "cashFlowSettings",
  "suppliers",
  "supplierPayments",
  "supplierOpenings",
  "supplierOffers",
  "purchaseInvoices",
  "supplierItemMaps",
  "purchasePriceRecords",
  "inventoryMovements",
  "inventoryBalances",
  "posImports",
  "posProductMaps",
  "posColumnMaps",
  "posZReports",
  "posFinanceEntries",
  "stockCounts",
  "stockCountSessions",
  "salesAiReports",
  "inventory_links",
  "productChangeHistory",
];

function credential() {
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
  if (privateKey.startsWith("\"")) privateKey = privateKey.slice(1, -1);
  privateKey = privateKey.replace(/\\n/g, "\n");
  return cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey,
  });
}

function plain(value) {
  if (value == null) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

const app = initializeApp({ credential: credential() });
const db = getFirestore(app);
const stamp = new Date().toISOString().slice(0, 10);
const dir = `backups/inventory-costing-${stamp}`;
mkdirSync(dir, { recursive: true });

const summary = {};
for (const name of COLLECTIONS) {
  const snap = await db.collection(name).get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, ...plain(doc.data()) }));
  writeFileSync(`${dir}/${name}.json`, JSON.stringify(rows));
  summary[name] = rows.length;
  console.log(`${name}: ${rows.length}`);
}

const products = await db.collection("products").get();
const productCosts = products.docs.map((doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    price: data.price ?? null,
    cost: data.cost ?? null,
    profit: data.profit ?? null,
    costVerified: data.costVerified === true,
  };
});
writeFileSync(`${dir}/product-cost-fields.json`, JSON.stringify(productCosts));
const withCost = productCosts.filter((row) => Number(row.cost) > 0).length;
const verified = productCosts.filter((row) => row.costVerified).length;
summary.products = products.size;
summary.productsWithCost = withCost;
summary.productsCostVerified = verified;
console.log(`products: ${products.size}`);
console.log(`productsWithCost: ${withCost}`);
console.log(`productsCostVerified: ${verified}`);

const invoices = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(`${dir}/purchaseInvoices.json`, "utf8")));
const invoiceStatus = {};
for (const row of invoices) {
  const key = `${row.status || "none"}/${row.stockStatus || "none"}`;
  invoiceStatus[key] = (invoiceStatus[key] || 0) + 1;
}
console.log("invoiceStatus", JSON.stringify(invoiceStatus));

const cash = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(`${dir}/cashFlowEntries.json`, "utf8")));
const cashSource = {};
for (const row of cash) {
  const key = row.source || "none";
  cashSource[key] = (cashSource[key] || 0) + 1;
}
console.log("cashSource", JSON.stringify(cashSource));

writeFileSync(`${dir}/summary.json`, JSON.stringify({ summary, invoiceStatus, cashSource, createdAt: new Date().toISOString() }, null, 2));
console.log(`backup: ${dir}`);
