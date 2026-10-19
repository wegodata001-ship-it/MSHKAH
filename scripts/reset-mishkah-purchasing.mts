/**
 * Targeted reset for the Mishkah purchasing workspace.
 *
 * Default is dry-run. Pass `--apply` to actually delete.
 *
 * Scope (deleted):
 *   purchaseInvoices, supplierOffers, supplierItemMaps, purchasePriceRecords,
 *   suppliers, supplierPayments, supplierOpenings,
 *   inventoryMovements, inventoryBalances, stockCounts, stockCountSessions,
 *   breakEvenFixedCosts, breakEvenVariableCosts, breakEvenSettings, breakEvenSnapshots,
 *   cashFlowEntries that come from supplier payments or supplier invoices.
 *   Storage files under `purchase-invoices/*` and `invoice-files/*`.
 *   Ingredients that no recipe or cost link uses.
 *
 * Preserved (never touched):
 *   products, categories, dishRecipes, productCostLinks, costingSettings,
 *   costingSnapshots, costingImportHistory, orders, payments, posImports,
 *   posZReports, posFinanceEntries, posProductMaps, posColumnMaps.
 *   All cost fields on ingredients that recipes or cost links reference.
 *
 * On ingredients that stay, we clear only: compareGroupId, compareGroupName,
 * lastSupplierId, lastReceivedAt, lastPurchasedAt.
 */

import { config } from "dotenv";
config({ path: ".env" });

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { getAdminBucket, getAdminDb } from "../src/lib/firebase/admin";

const getStorageBucket = getAdminBucket;
import { COLLECTIONS, STORAGE_PATHS } from "../src/lib/firebase/collections";

type DocLike = { id: string; data(): Record<string, unknown>; ref: FirebaseFirestore.DocumentReference };
type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const BACKUP_ROOT = resolve("tmp", `reset-${new Date().toISOString().replace(/[:.]/g, "-")}`);

const PURCHASING_COLLECTIONS: CollectionName[] = [
  COLLECTIONS.purchaseInvoices,
  COLLECTIONS.supplierOffers,
  COLLECTIONS.supplierItemMaps,
  COLLECTIONS.purchasePriceRecords,
  COLLECTIONS.suppliers,
  COLLECTIONS.supplierPayments,
  COLLECTIONS.supplierOpenings,
  COLLECTIONS.inventoryMovements,
  COLLECTIONS.inventoryBalances,
  COLLECTIONS.stockCounts,
  COLLECTIONS.stockCountSessions,
];

const BREAK_EVEN_COLLECTIONS: CollectionName[] = [
  COLLECTIONS.breakEvenFixedCosts,
  COLLECTIONS.breakEvenVariableCosts,
  COLLECTIONS.breakEvenSettings,
  COLLECTIONS.breakEvenSnapshots,
];

const PROTECTED_INGREDIENT_FIELDS = [
  "id",
  "name",
  "originKind",
  "category",
  "purchasePrice",
  "purchaseQuantity",
  "purchaseUnit",
  "baseUnit",
  "costPerBaseUnit",
  "minStock",
  "recommendedStock",
  "active",
  "createdAt",
  "updatedAt",
] as const;

async function backupCollection(name: CollectionName): Promise<DocLike[]> {
  const db = getAdminDb();
  const snap = await db.collection(name).get();
  await mkdir(BACKUP_ROOT, { recursive: true });
  const path = resolve(BACKUP_ROOT, `${name}.jsonl`);
  const stream = createWriteStream(path, { encoding: "utf8" });
  for (const doc of snap.docs) {
    stream.write(`${JSON.stringify({ id: doc.id, data: doc.data() })}\n`);
  }
  stream.end();
  return snap.docs.map((doc) => ({ id: doc.id, data: () => doc.data() as Record<string, unknown>, ref: doc.ref }));
}

async function deleteDocs(docs: DocLike[]): Promise<number> {
  if (!APPLY || docs.length === 0) return 0;
  const db = getAdminDb();
  let committed = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const slice = docs.slice(i, i + 400);
    const batch = db.batch();
    for (const doc of slice) batch.delete(doc.ref);
    await batch.commit();
    committed += slice.length;
  }
  return committed;
}

async function deleteStoragePrefix(prefix: string): Promise<number> {
  const bucket = getStorageBucket();
  const [files] = await bucket.getFiles({ prefix: `${prefix}/` });
  if (!APPLY) return files.length;
  let deleted = 0;
  for (const file of files) {
    try {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (error) {
      console.warn(`storage delete failed for ${file.name}: ${(error as Error).message}`);
    }
  }
  return deleted;
}

async function main() {
  console.log(`Project: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
  console.log(`Mode: ${APPLY ? "APPLY (destructive)" : "DRY RUN"}`);
  console.log(`Backup dir: ${BACKUP_ROOT}`);

  const db = getAdminDb();
  const beforeCounts: Record<string, number> = {};
  const afterCounts: Record<string, number> = {};

  // Snapshot everything we may touch, including ingredients and recipes for the costing check.
  const touched: Record<string, DocLike[]> = {};
  for (const name of [...PURCHASING_COLLECTIONS, ...BREAK_EVEN_COLLECTIONS, COLLECTIONS.cashFlowEntries, COLLECTIONS.ingredients]) {
    touched[name] = await backupCollection(name);
    beforeCounts[name] = touched[name].length;
    console.log(`backup ${name}: ${touched[name].length}`);
  }
  const recipesSnap = await db.collection(COLLECTIONS.dishRecipes).get();
  await writeFile(resolve(BACKUP_ROOT, "dishRecipes.snapshot.jsonl"), recipesSnap.docs.map((d) => `${JSON.stringify({ id: d.id, data: d.data() })}\n`).join(""));
  const costLinksSnap = await db.collection(COLLECTIONS.productCostLinks).get();
  await writeFile(resolve(BACKUP_ROOT, "productCostLinks.snapshot.jsonl"), costLinksSnap.docs.map((d) => `${JSON.stringify({ id: d.id, data: d.data() })}\n`).join(""));

  // Used ingredient set: anything a recipe line or product cost link references.
  const used = new Set<string>();
  for (const recipe of recipesSnap.docs) {
    const lines = (recipe.data().ingredients as Array<{ ingredientId?: string }> | undefined) ?? [];
    for (const line of lines) if (line.ingredientId) used.add(String(line.ingredientId));
  }
  for (const link of costLinksSnap.docs) {
    const data = link.data();
    const id = data.ingredientId;
    if (typeof id === "string" && id) used.add(id);
  }
  console.log(`Ingredients referenced by a recipe or cost link: ${used.size}`);

  // Costing fingerprint before the reset.
  const fingerprintBefore = new Map<string, string>();
  for (const doc of touched[COLLECTIONS.ingredients]) {
    if (!used.has(doc.id)) continue;
    const data = doc.data();
    fingerprintBefore.set(doc.id, JSON.stringify(PROTECTED_INGREDIENT_FIELDS.map((key) => (data as Record<string, unknown>)[key] ?? null)));
  }
  await writeFile(resolve(BACKUP_ROOT, "costing-fingerprint-before.json"), JSON.stringify(Object.fromEntries(fingerprintBefore), null, 2));

  // Which cash flow entries belong to supplier payments or supplier invoices?
  const cashDocs = touched[COLLECTIONS.cashFlowEntries];
  const supplierCash = cashDocs.filter((doc) => {
    if (doc.id.startsWith("cf-sp-")) return true;
    const data = doc.data();
    if (typeof data.invoiceId === "string" && data.invoiceId) return true;
    return false;
  });
  console.log(`Cash flow entries from supplier payments or invoices: ${supplierCash.length} / ${cashDocs.length}`);

  // Report ingredient split.
  const ingredientDocs = touched[COLLECTIONS.ingredients];
  const ingredientKeep = ingredientDocs.filter((doc) => used.has(doc.id));
  const ingredientRemove = ingredientDocs.filter((doc) => !used.has(doc.id));
  console.log(`Ingredients to keep (used by a recipe or cost link): ${ingredientKeep.length}`);
  console.log(`Ingredients to delete (unused): ${ingredientRemove.length}`);

  // Storage count.
  const invoiceFiles = await getStorageBucket().getFiles({ prefix: `${STORAGE_PATHS.invoices}/` });
  const invoiceSources = await getStorageBucket().getFiles({ prefix: `${STORAGE_PATHS.invoiceFiles}/` });
  console.log(`Storage files under ${STORAGE_PATHS.invoices}/: ${invoiceFiles[0].length}`);
  console.log(`Storage files under ${STORAGE_PATHS.invoiceFiles}/: ${invoiceSources[0].length}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to execute the reset.");
    return;
  }

  // --- Destructive section ---
  console.log("\nApplying reset…");

  for (const name of PURCHASING_COLLECTIONS) {
    const removed = await deleteDocs(touched[name]);
    console.log(`deleted ${removed} from ${name}`);
  }
  for (const name of BREAK_EVEN_COLLECTIONS) {
    const removed = await deleteDocs(touched[name]);
    console.log(`deleted ${removed} from ${name}`);
  }
  const removedCash = await deleteDocs(supplierCash);
  console.log(`deleted ${removedCash} from ${COLLECTIONS.cashFlowEntries} (supplier scope only)`);

  // Clear compare group and purchase stamp on retained ingredients.
  let cleared = 0;
  for (let i = 0; i < ingredientKeep.length; i += 400) {
    const slice = ingredientKeep.slice(i, i + 400);
    const batch = db.batch();
    for (const doc of slice) {
      batch.update(doc.ref, {
        compareGroupId: null,
        compareGroupName: null,
        lastSupplierId: null,
        lastReceivedAt: null,
        lastPurchasedAt: null,
      });
    }
    await batch.commit();
    cleared += slice.length;
  }
  console.log(`cleared compare group and purchase stamp on ${cleared} ingredients`);

  // Delete unused ingredients.
  const removedIngredients = await deleteDocs(ingredientRemove);
  console.log(`deleted ${removedIngredients} unused ingredients`);

  // Storage files.
  const removedInvoiceStorage = await deleteStoragePrefix(STORAGE_PATHS.invoices);
  const removedInvoiceSourceStorage = await deleteStoragePrefix(STORAGE_PATHS.invoiceFiles);
  console.log(`deleted ${removedInvoiceStorage} storage files under ${STORAGE_PATHS.invoices}/`);
  console.log(`deleted ${removedInvoiceSourceStorage} storage files under ${STORAGE_PATHS.invoiceFiles}/`);

  // After counts.
  for (const name of [...PURCHASING_COLLECTIONS, ...BREAK_EVEN_COLLECTIONS, COLLECTIONS.cashFlowEntries, COLLECTIONS.ingredients]) {
    const snap = await db.collection(name).get();
    afterCounts[name] = snap.size;
  }

  // Costing fingerprint after. Verify it did not change for kept ingredients.
  const fingerprintAfter = new Map<string, string>();
  const retainedSnap = await db.collection(COLLECTIONS.ingredients).get();
  for (const doc of retainedSnap.docs) {
    if (!used.has(doc.id)) continue;
    const data = doc.data();
    fingerprintAfter.set(doc.id, JSON.stringify(PROTECTED_INGREDIENT_FIELDS.map((key) => (data as Record<string, unknown>)[key] ?? null)));
  }
  await writeFile(resolve(BACKUP_ROOT, "costing-fingerprint-after.json"), JSON.stringify(Object.fromEntries(fingerprintAfter), null, 2));

  const costingDiffs: { id: string; before: string; after: string }[] = [];
  for (const [id, before] of fingerprintBefore) {
    const after = fingerprintAfter.get(id);
    if (after !== before) costingDiffs.push({ id, before, after: after ?? "<missing>" });
  }
  if (costingDiffs.length) {
    await writeFile(resolve(BACKUP_ROOT, "costing-diffs.json"), JSON.stringify(costingDiffs, null, 2));
    console.error(`COSTING CHANGED on ${costingDiffs.length} ingredients. See costing-diffs.json. ABORTING counts summary.`);
    process.exitCode = 2;
  } else {
    console.log("Costing fingerprint matched for every retained ingredient.");
  }

  await writeFile(resolve(BACKUP_ROOT, "counts.json"), JSON.stringify({ before: beforeCounts, after: afterCounts }, null, 2));
  console.log(`\nBackup written to ${BACKUP_ROOT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
