import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Page } from "playwright-core";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { postInvoiceStock } from "../src/lib/inventory/invoice-admin-write";
import { matchInventoryProduct } from "../src/lib/inventory/invoice-smart-match";
import type { CostingIngredient } from "../src/lib/costing/types";
import type { PurchaseInvoice, SupplierItemMap } from "../src/lib/inventory/types";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const INVOICE_ID = "qa-assign-1910";
const SUPPLIER_ID = "qa-supplier-1910";
const EXISTING_ID = "qa-existing-1910";
const NEW_NAME = "בדיקת מוצר חדש 1910";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetFixture() {
  const db = getAdminDb();
  const created = await db.collection(COLLECTIONS.ingredients).where("name", "==", NEW_NAME).get();
  const ids = [EXISTING_ID, ...created.docs.map((doc) => doc.id)];
  const moves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
  await Promise.all(moves.docs.map((doc) => doc.ref.delete()));
  await Promise.all(ids.map((id) => db.collection(COLLECTIONS.inventoryBalances).doc(id).set({ quantityBase: 0, updatedAt: FieldValue.serverTimestamp() })));
  await Promise.all(created.docs.map((doc) => doc.ref.delete()));
  await db.collection(COLLECTIONS.suppliers).doc(SUPPLIER_ID).set({
    name: "בדיקת ספק קליטה",
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection(COLLECTIONS.ingredients).doc(EXISTING_ID).set({
    name: "בדיקת קיים 1910",
    purchasePrice: 0,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    costPerBaseUnit: 0,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const row = (patch: Record<string, unknown>) => ({
    rawName: "בדיקת מוצר חדש",
    originalDescription: "בדיקת מוצר חדש",
    quantity: 1,
    unit: "unit",
    unitPrice: 4,
    vatType: "inclusive",
    vatRate: 0.18,
    lineType: "INVENTORY_ITEM",
    skipInventory: false,
    matchKind: "new",
    matchConfirmed: true,
    plannedProductName: "בדיקת מוצר חדש",
    sku: "QA-SKU-1910",
    postedToStock: false,
    ...patch,
  });
  await db.collection(COLLECTIONS.purchaseInvoices).doc(INVOICE_ID).set({
    supplierId: SUPPLIER_ID,
    supplierName: "בדיקת ספק קליטה",
    invoiceNumber: "QA-ASSIGN-1910",
    invoiceDate: "2026-10-19",
    currency: "ILS",
    status: "draft",
    stockStatus: "none",
    scanStatus: "done",
    sourceFile: { kind: "image", name: "qa-assign.png" },
    lines: [row({ key: "qa-new-a" }), row({ key: "qa-new-b" })],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(2500);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
  const hebrew = page.getByRole("button", { name: "עברית" });
  if (await hebrew.count()) await hebrew.first().click();
  await sleep(400);
}

async function main() {
  if (!existsSync(CHROME)) throw new Error("chrome missing");
  await resetFixture();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await login(page);
    await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
    const row = page.locator("tr", { hasText: "QA-ASSIGN-1910" }).first();
    await row.waitFor({ timeout: 30000 });
    await row.getByRole("button", { name: "עריכה" }).click();
    const pending = page.getByText("מוצר חדש — ייווצר וישויך באישור הקליטה").first();
    await pending.waitFor({ timeout: 20000 });
    record("new product state", true);

    const first = page.locator("#invoice-line-qa-new-a").first();
    await first.getByLabel("שם חומר הגלם").fill(NEW_NAME);
    record("edited suggested name", (await first.getByLabel("שם חומר הגלם").inputValue()) === NEW_NAME);
    record("invoice name kept", (await first.locator("p").first().innerText()).includes("בדיקת מוצר חדש"));

    const second = page.locator("#invoice-line-qa-new-b").first();
    await second.getByRole("button", { name: "שינוי שיוך" }).click();
    await second.getByPlaceholder("חיפוש חומר גלם").fill("בדיקת קיים 1910");
    await second.getByRole("button", { name: "בדיקת קיים 1910" }).click();
    await second.getByText("עודכן").waitFor({ timeout: 20000 });
    record("changed to existing ingredient", (await second.innerText()).includes("בדיקת קיים 1910"));

    await page.getByText("ייווצרו 1 חומרי גלם חדשים · 1 שורות ישויכו לקיימים").first().waitFor({ timeout: 10000 });
    record("assignment summary", true);

    await page.getByRole("button", { name: "אשר וקלוט למלאי" }).click();
    await page.getByText("הקליטה הושלמה").first().waitFor({ timeout: 40000 });
    const body = await page.locator("body").innerText();
    record("intake lists both products", body.includes(NEW_NAME) && body.includes("בדיקת קיים 1910"));
  } catch (error) {
    record("flow", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: "tmp/intake-assign-qa.png", fullPage: true }).catch(() => undefined);
  } finally {
    await browser.close();
  }

  const db = getAdminDb();
  const created = await db.collection(COLLECTIONS.ingredients).where("name", "==", NEW_NAME).get();
  record("one new ingredient card", created.size === 1, `cards=${created.size}`);
  const moves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
  const before = moves.docs.map((doc) => `${doc.data().productId}:${doc.data().quantityBase}`).join(",");
  const snap = await db.collection(COLLECTIONS.purchaseInvoices).doc(INVOICE_ID).get();
  const invoice = { id: snap.id, ...snap.data() } as PurchaseInvoice;
  if (moves.size > 0) {
    const again = await postInvoiceStock(db, invoice, undefined, "qa-assign-retry");
    const movesAfter = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
    record("retry reuses movements", again.postedKeys.length === 0 && movesAfter.size === moves.size, `reused=${again.reusedKeys.join("|")} before=${before}`);
  } else {
    record("retry reuses movements", false, "no movements were created");
  }
  const maps = await db.collection(COLLECTIONS.supplierItemMaps).where("supplierId", "==", SUPPLIER_ID).get();
  const mapRows = maps.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SupplierItemMap);
  const ingredient = created.docs[0] ? ({ id: created.docs[0].id, ...created.docs[0].data() } as CostingIngredient) : undefined;
  const next = ingredient
    ? matchInventoryProduct({ name: "בדיקת מוצר חדש", sku: "QA-SKU-1910", unit: "unit", quantity: 8 }, [ingredient], mapRows, SUPPLIER_ID)
    : undefined;
  record("next invoice remembers sku despite a different quantity", next?.kind === "mapped" && next.item?.id === ingredient?.id, next ? `${next.kind}:${next.item?.id}` : "no-match");
  const conflict = ingredient
    ? matchInventoryProduct({ name: "בדיקת מוצר חדש", sku: "QA-SKU-1910", unit: "kg", quantity: 8 }, [ingredient], mapRows, SUPPLIER_ID)
    : undefined;
  record("conflicting unit stays linked and is flagged", conflict?.kind === "mapped" && conflict.packConflict === true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
