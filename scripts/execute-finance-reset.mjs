/**
 * Idempotent production reset of finance, inventory, and procurement.
 * Archives source documents first. Does not touch menu, orders, or Storage files.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT = "mshkah";
const ORIGINAL = "backups/finance-procurement-2026-10-20";
const RUN = "backups/finance-reset-run";
const ARCHIVE = {
  purchaseInvoices: "archivePurchaseInvoices",
  posZReports: "archivePosZReports",
  inventoryMovements: "archiveInventoryMovements",
};
const CLEAR = [
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
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.path === "string" && typeof value.id === "string" && value.firestore) return value.path;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

function assertBackup() {
  if (!existsSync(join(ORIGINAL, "manifest.json"))) throw new Error("BACKUP_MISSING");
  const manifest = JSON.parse(readFileSync(join(ORIGINAL, "manifest.json"), "utf8"));
  if (manifest.projectId !== PROJECT || manifest.restoreCheck !== "pass") throw new Error("BACKUP_INVALID");
  const collections = CLEAR.filter((name) => existsSync(join(ORIGINAL, `${name}.json`)));
  if (collections.length !== CLEAR.length) throw new Error(`BACKUP_COLLECTIONS_${collections.length}`);
  for (const name of [...CLEAR, "product-cost-fields"]) {
    const body = readFileSync(join(ORIGINAL, `${name}.json`));
    const rows = JSON.parse(body.toString("utf8"));
    if (!Array.isArray(rows)) throw new Error(`BACKUP_UNREADABLE_${name}`);
  }
  const files = manifest.storage.filter((item) => !item.missing);
  if (files.length !== 17) throw new Error(`BACKUP_STORAGE_${files.length}`);
  for (const item of files) {
    const body = readFileSync(join(ORIGINAL, "storage", item.path));
    const sha = createHash("sha256").update(body).digest("hex");
    if (sha !== item.sha256) throw new Error(`BACKUP_HASH_${item.path}`);
  }
  return manifest;
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (projectId !== PROJECT) throw new Error(`WRONG_PROJECT_${projectId}`);
const manifest = assertBackup();
const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
const app = initializeApp({ credential: credential(), storageBucket: bucketName });
const db = getFirestore(app);
const bucket = getStorage(app).bucket(bucketName);
mkdirSync(join(RUN, "pre-reset"), { recursive: true });

const journalPath = join(RUN, "journal.json");
const journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath, "utf8"))
  : { archived: {}, deleted: {}, products: {}, startedAt: new Date().toISOString() };
const saveJournal = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2));

await db.collection("systemOps").doc("financeReset").set({
  status: "running",
  projectId,
  startedAt: new Date().toISOString(),
});

const before = {};
for (const name of [...CLEAR, ...PROTECT]) {
  const snap = await db.collection(name).get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, ...plain(doc.data()) }));
  before[name] = rows.length;
  if (CLEAR.includes(name)) writeFileSync(join(RUN, "pre-reset", `${name}.json`), JSON.stringify(rows));
  console.log(`live ${name}: ${rows.length}`);
}
const products = await db.collection("products").get();
const productBefore = products.docs.map((doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    price: data.price ?? null,
    nameHe: data.nameHe ?? data.name_he ?? data.name ?? null,
    imageUrl: data.imageUrl ?? null,
    categoryId: data.categoryId ?? null,
    cost: data.cost ?? null,
    profit: data.profit ?? null,
  };
});
writeFileSync(join(RUN, "pre-reset", "product-cost-fields.json"), JSON.stringify(productBefore));
const protectedBefore = Object.fromEntries(PROTECT.map((name) => [name, before[name]]));
writeFileSync(join(RUN, "pre-reset", "counts.json"), JSON.stringify({ before, protectedBefore, at: new Date().toISOString() }, null, 2));

const originalInvoices = JSON.parse(readFileSync(join(ORIGINAL, "purchaseInvoices.json"), "utf8")).map((row) => row.id);
const liveInvoiceIds = JSON.parse(readFileSync(join(RUN, "pre-reset", "purchaseInvoices.json"), "utf8")).map((row) => row.id);
const newInvoices = liveInvoiceIds.filter((id) => !originalInvoices.includes(id));
console.log("newInvoicesSinceBackup", newInvoices.length);

async function commit(ops) {
  for (let index = 0; index < ops.length; index += 400) {
    const batch = db.batch();
    for (const op of ops.slice(index, index + 400)) op(batch);
    if (ops.slice(index, index + 400).length) await batch.commit();
  }
}

const archived = {};
for (const [source, target] of Object.entries(ARCHIVE)) {
  const snap = await db.collection(source).get();
  const ops = [];
  for (const doc of snap.docs) {
    const ref = db.collection(target).doc(doc.id);
    ops.push((batch) => batch.set(ref, {
      ...doc.data(),
      sourceCollection: source,
      sourceId: doc.id,
      archivedAt: new Date().toISOString(),
      archiveReason: "finance-inventory-reset-2026-10-20",
      excludeFromActiveWork: true,
      repostBlocked: true,
    }));
    journal.archived[`${target}/${doc.id}`] = true;
  }
  await commit(ops);
  const check = await db.collection(target).get();
  const sourceIds = new Set(snap.docs.map((doc) => doc.id));
  const archivedIds = new Set(check.docs.map((doc) => doc.id));
  for (const id of sourceIds) {
    if (!archivedIds.has(id)) throw new Error(`ARCHIVE_MISSING_${target}_${id}`);
  }
  archived[target] = check.size;
  saveJournal();
  console.log(`archived ${target}: ${check.size}`);
}

const deleted = {};
for (const name of CLEAR) {
  const snap = await db.collection(name).get();
  await commit(snap.docs.map((doc) => (batch) => batch.delete(doc.ref)));
  const left = await db.collection(name).count().get();
  if (left.data().count !== 0) throw new Error(`NOT_EMPTY_${name}_${left.data().count}`);
  deleted[name] = snap.size;
  journal.deleted[name] = snap.size;
  saveJournal();
  console.log(`cleared ${name}: ${snap.size}`);
}

let nulled = 0;
const productOps = [];
for (const doc of products.docs) {
  productOps.push((batch) => batch.update(doc.ref, {
    cost: null,
    profit: null,
    costVerified: null,
    costVerifiedBy: null,
    costVerifiedAt: null,
  }));
  nulled += 1;
}
await commit(productOps);
journal.products.nulled = nulled;
saveJournal();

const after = {};
for (const name of [...CLEAR, ...PROTECT]) {
  const snap = await db.collection(name).count().get();
  after[name] = snap.data().count;
}
for (const name of PROTECT) {
  if (after[name] !== protectedBefore[name]) throw new Error(`PROTECTED_CHANGED_${name}`);
}
const afterProducts = await db.collection("products").get();
let priceMismatch = 0;
let costLeft = 0;
const beforeById = new Map(productBefore.map((row) => [row.id, row]));
for (const doc of afterProducts.docs) {
  const data = doc.data();
  const prior = beforeById.get(doc.id);
  if (!prior || prior.price !== (data.price ?? null)) priceMismatch += 1;
  if (data.cost != null || data.profit != null || data.costVerified != null) costLeft += 1;
}
if (priceMismatch || costLeft) throw new Error(`PRODUCT_CHECK_price_${priceMismatch}_cost_${costLeft}`);

let storageLeft = 0;
for (const prefix of STORAGE_PREFIXES) {
  const [files] = await bucket.getFiles({ prefix });
  storageLeft += files.filter((file) => !file.name.endsWith("/")).length;
}

const report = {
  projectId,
  backup: ORIGINAL,
  backupUntouched: existsSync(join(ORIGINAL, "manifest.json")),
  before,
  deleted,
  archived,
  nulledProductCosts: nulled,
  after,
  priceMismatch,
  costLeft,
  storageFilesStillPresent: storageLeft,
  newInvoicesBackedUpBeforeDelete: newInvoices,
  finishedAt: new Date().toISOString(),
};
writeFileSync(join(RUN, "report.json"), JSON.stringify(report, null, 2));
await db.collection("systemOps").doc("financeReset").set({
  status: "complete",
  projectId,
  finishedAt: report.finishedAt,
  deleted,
  archived,
});
console.log(JSON.stringify(report, null, 2));
