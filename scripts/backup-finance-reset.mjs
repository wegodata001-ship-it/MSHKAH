/**
 * Read-only backup of finance, inventory, and procurement data.
 * Writes local JSON and Storage copies. Does not write to Firestore or Storage.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const RESET = [
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
  "reportRuns",
  "productChangeHistory",
  "inventory_links",
];

const PROTECT = ["products", "categories", "orders", "payments", "customers", "users", "settings"];
const STORAGE_PREFIXES = ["invoice-files/", "purchase-invoices/", "pos-z-reports/"];

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
  if (typeof value.toDate === "function") return { __type: "timestamp", iso: value.toDate().toISOString() };
  if (typeof value.path === "string" && typeof value.id === "string" && value.firestore) {
    return { __type: "ref", path: value.path };
  }
  if (Buffer.isBuffer(value)) return { __type: "bytes", base64: value.toString("base64") };
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

function collectPaths(value, into) {
  if (value == null) return;
  if (typeof value === "string") {
    const match = value.match(/\/o\/([^?]+)/);
    if (match) into.add(decodeURIComponent(match[1]));
    if (
      value.startsWith("invoice-files/") ||
      value.startsWith("purchase-invoices/") ||
      value.startsWith("pos-z-reports/")
    ) {
      into.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, into);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectPaths(item, into);
  }
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
const app = initializeApp({
  credential: credential(),
  storageBucket: bucketName,
});
const db = getFirestore(app);
const bucket = getStorage(app).bucket(bucketName);
const dir = "backups/finance-procurement-2026-10-20";
mkdirSync(dir, { recursive: true });

const rootCols = await db.listCollections();
const rootNames = rootCols.map((col) => col.id).sort();
const rootCounts = {};
for (const name of rootNames) {
  const snap = await db.collection(name).count().get();
  rootCounts[name] = snap.data().count;
}
writeFileSync(join(dir, "root-collections.json"), JSON.stringify({ projectId, rootCounts }, null, 2));
console.log("project", projectId);
console.log("bucket", bucketName);
console.log("root", JSON.stringify(rootCounts));

const summary = {};
const subCount = {};
const storagePaths = new Set();

async function subcollections(ref, depth) {
  if (depth > 5) return {};
  const cols = await ref.listCollections();
  const out = {};
  for (const col of cols) {
    const snap = await col.get();
    subCount[col.id] = (subCount[col.id] || 0) + snap.size;
    out[col.id] = [];
    for (const doc of snap.docs) {
      const data = plain(doc.data());
      collectPaths(data, storagePaths);
      out[col.id].push({
        id: doc.id,
        ...data,
        __subcollections: await subcollections(doc.ref, depth + 1),
      });
    }
  }
  return out;
}

for (const name of RESET) {
  const snap = await db.collection(name).get();
  const rows = [];
  for (const doc of snap.docs) {
    const data = plain(doc.data());
    collectPaths(data, storagePaths);
    const nested = await subcollections(doc.ref, 1);
    rows.push({ id: doc.id, ...data, __subcollections: nested });
  }
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(rows));
  summary[name] = rows.length;
  console.log(`${name}: ${rows.length}`);
}

const products = await db.collection("products").get();
const productCosts = products.docs.map((doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    nameHe: data.nameHe ?? data.name_he ?? data.name ?? null,
    price: data.price ?? null,
    cost: data.cost ?? null,
    profit: data.profit ?? null,
    costVerified: data.costVerified === true,
    costVerifiedBy: data.costVerifiedBy ?? null,
    costVerifiedAt: data.costVerifiedAt ?? null,
    imageUrl: data.imageUrl ?? null,
    categoryId: data.categoryId ?? null,
  };
});
writeFileSync(join(dir, "product-cost-fields.json"), JSON.stringify(productCosts));
summary.products = products.size;
summary.productsWithPrice = productCosts.filter((row) => row.price != null).length;
summary.productsWithCost = productCosts.filter((row) => Number(row.cost) > 0).length;
summary.productsCostVerified = productCosts.filter((row) => row.costVerified).length;

const protectedCounts = {};
for (const name of PROTECT) {
  const snap = await db.collection(name).count().get();
  protectedCounts[name] = snap.data().count;
}
console.log("protected", JSON.stringify(protectedCounts));

for (const prefix of STORAGE_PREFIXES) {
  const [files] = await bucket.getFiles({ prefix });
  for (const file of files) {
    if (!file.name.endsWith("/")) storagePaths.add(file.name);
  }
}

const storageManifest = [];
for (const path of [...storagePaths].sort()) {
  if (path.startsWith("products/") || path.startsWith("banners/") || path.startsWith("categories/")) continue;
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) {
    storageManifest.push({ path, missing: true });
    console.log("storage missing", path);
    continue;
  }
  const [buf] = await file.download();
  const dest = join(dir, "storage", path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  storageManifest.push({
    path,
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  });
  console.log("storage", path, buf.length);
}

const fileHashes = {};
for (const name of [...RESET, "product-cost-fields"]) {
  const body = readFileSync(join(dir, `${name}.json`));
  const parsed = JSON.parse(body.toString("utf8"));
  const count = Array.isArray(parsed) ? parsed.length : -1;
  const expected = name === "product-cost-fields" ? summary.products : summary[name];
  if (count !== expected) throw new Error(`restore check failed for ${name}: ${count} != ${expected}`);
  fileHashes[name] = { count, sha256: createHash("sha256").update(body).digest("hex") };
}
for (const item of storageManifest) {
  if (item.missing) continue;
  const body = readFileSync(join(dir, "storage", item.path));
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== item.sha256 || body.length !== item.bytes) {
    throw new Error(`storage restore check failed for ${item.path}`);
  }
}

const manifest = {
  projectId,
  bucket: bucketName,
  createdAt: new Date().toISOString(),
  summary,
  protectedCounts,
  subCount,
  storage: storageManifest,
  fileHashes,
  restoreCheck: "pass",
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("backup", dir);
console.log("storageFiles", storageManifest.length);
console.log("subcollections", JSON.stringify(subCount));
