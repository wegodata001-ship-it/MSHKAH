import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright-core";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const INVOICE_ID = "qa-intake-1910";
const SEEDED_INGREDIENT = "qa-intake-ingredient";
const CREATED_NAME = "בדיקת קליטה חדשה 1910";
const OUT = "tmp/intake-approve-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetFixture() {
  const db = getAdminDb();
  const created = await db.collection(COLLECTIONS.ingredients).where("name", "==", CREATED_NAME).get();
  const ingredientIds = [SEEDED_INGREDIENT, ...created.docs.map((doc) => doc.id)];
  const moves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
  await Promise.all(moves.docs.map((doc) => doc.ref.delete()));
  await Promise.all(
    ingredientIds.map((id) =>
      db.collection(COLLECTIONS.inventoryBalances).doc(id).set({ ingredientId: id, quantityBase: 0, updatedAt: FieldValue.serverTimestamp() })
    )
  );
  await db.collection(COLLECTIONS.ingredients).doc(SEEDED_INGREDIENT).set({
    name: "בדיקת קליטה 1910",
    category: "בדיקות",
    purchasePrice: 0,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    costPerBaseUnit: 0,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const line = (patch: Record<string, unknown>) => ({
    quantity: 1,
    unitPrice: 10,
    discount: null,
    vatType: "inclusive",
    taxMode: "inclusive",
    vatRate: 0.18,
    lineType: "INVENTORY_ITEM",
    skipInventory: false,
    postedToStock: false,
    ...patch,
  });
  await db.collection(COLLECTIONS.purchaseInvoices).doc(INVOICE_ID).set({
    supplierName: "בדיקת קליטה",
    invoiceNumber: "QA-INTAKE-1910",
    invoiceDate: "2026-10-19",
    receivedAt: "2026-10-19",
    currency: "ILS",
    status: "draft",
    stockStatus: "none",
    scanStatus: "done",
    sourceFile: { kind: "image", name: "qa-intake.png" },
    lines: [
      line({
        key: "qa-line-material",
        rawName: "בדיקת שיוך",
        originalDescription: "בדיקת שיוך",
        unit: "unit",
        productId: null,
        matchKind: "none",
        matchConfirmed: false,
      }),
      line({
        key: "qa-line-unit",
        rawName: "בדיקת יחידה",
        originalDescription: "בדיקת יחידה",
        unit: null,
        productId: SEEDED_INGREDIENT,
        matchKind: "exact",
        matchConfirmed: true,
      }),
    ],
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
  if (await hebrew.count()) await hebrew.click();
  await sleep(500);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await resetFixture();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const notes: string[] = [];
  try {
    await login(page);
    await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
    const row = page.locator("tr", { hasText: "QA-INTAKE-1910" });
    await row.waitFor({ timeout: 30000 });
    await row.getByRole("button", { name: "עריכה" }).click();
    const approve = page.getByRole("button", { name: "אשר וקלוט למלאי" });
    await approve.waitFor({ timeout: 20000 });

    await approve.click();
    const hold = page.getByText("הקליטה טרם התחילה — 2 שורות דורשות השלמה").first();
    await hold.waitFor({ timeout: 15000 });
    const holdText = await hold.locator("xpath=ancestor::div[contains(@class,'bg-amber-50')]").innerText();
    record("missing rows block intake", holdText.includes("בדיקת שיוך") && holdText.includes("חסר שיוך לחומר גלם") && holdText.includes("בדיקת יחידה") && holdText.includes("חסרה יחידה"), holdText.replace(/\s+/g, " "));
    const highlighted = await page.locator("#invoice-line-qa-line-material-product").first().evaluate((node) => node.className.includes("ring-turquoise"));
    record("first error highlighted", highlighted);

    const material = page.locator("#invoice-line-qa-line-material").first();
    await material.locator("#invoice-line-qa-line-material-product input").fill("בדיקת קליטה 1910");
    await material.locator("select").first().selectOption({ label: "בדיקת קליטה 1910" });
    await material.getByText("עודכן").waitFor({ timeout: 20000 });
    record("saved mapping shows עודכן", true);

    await material.getByRole("button", { name: /צור חומר גלם/ }).click();
    const createRow = page.locator("tr", { has: page.getByPlaceholder("בדיקת שיוך") }).first();
    await createRow.locator("input").first().fill(CREATED_NAME);
    await createRow.getByRole("button", { name: "צור חומר גלם" }).click();
    await material.getByText("עודכן").waitFor({ timeout: 20000 });
    record("created ingredient shows עודכן", true);

    const unitRow = page.locator("#invoice-line-qa-line-unit").first();
    await unitRow.locator("#invoice-line-qa-line-unit-unit").selectOption("unit");
    await sleep(500);
    await unitRow.getByRole("button", { name: "עדכון שורה" }).click();
    await unitRow.getByText("עודכן").waitFor({ timeout: 20000 });
    record("unit update shows עודכן", true);

    await page.route("**/api/admin/inventory/invoice/stock-post", (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "nope" })
    );
    await approve.click();
    const failure = page.getByText("התקבלה תשובה לא תקינה מהשרת").first();
    await failure.waitFor({ timeout: 20000 });
    const stillSelected = await material.locator("select").first().inputValue();
    record("server failure keeps the selection", Boolean(stillSelected), stillSelected);
    await page.unroute("**/api/admin/inventory/invoice/stock-post");

    const retry = page.getByRole("button", { name: "קלוט למלאי", exact: true });
    await retry.click();
    await page.getByText("הקליטה הושלמה").first().waitFor({ timeout: 30000 });
    const summary = await page.locator("text=הקליטה הושלמה").locator("xpath=ancestor::*[contains(@class,'rounded')][1]").innerText().catch(async () => page.locator("body").innerText());
    record("intake completed", summary.includes(CREATED_NAME) || (await page.locator("body").innerText()).includes("הקליטה הושלמה"));
    notes.push(summary.slice(0, 500));
    const view = page.getByRole("button", { name: "צפייה במלאי" }).first();
    record("view inventory button", (await view.count()) > 0);
    await view.click();
    await page.getByText(CREATED_NAME).first().waitFor({ timeout: 20000 });
    record("inventory refreshed", true);

    await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
    await row.waitFor({ timeout: 30000 });
    await row.getByRole("button", { name: "עריכה" }).click();
    const approveAgain = page.getByRole("button", { name: "אשר וקלוט למלאי" });
    const postAgain = page.getByRole("button", { name: "קלוט למלאי", exact: true });
    record("posted invoice cannot be approved again", (await approveAgain.count()) === 0 || (await approveAgain.isDisabled()));
    record("posted invoice has no second post button", (await postAgain.count()) === 0);
  } catch (error) {
    record("flow", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
  } finally {
    await browser.close();
  }

  const db = getAdminDb();
  const moves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
  const balances = await Promise.all(
    [SEEDED_INGREDIENT].concat(
      (await db.collection(COLLECTIONS.ingredients).where("name", "==", CREATED_NAME).get()).docs.map((doc) => doc.id)
    ).map(async (id) => {
      const bal = await db.collection(COLLECTIONS.inventoryBalances).doc(id).get();
      return `${id}:${bal.data()?.quantityBase ?? 0}`;
    })
  );
  const quantities = moves.docs.map((doc) => `${doc.id}:${doc.data().quantity} ${doc.data().unit}`).join(", ");
  process.stdout.write(`MOVEMENTS ${moves.size} ${quantities}\n`);
  process.stdout.write(`BALANCES ${balances.join(", ")}\n`);
  if (notes[0]) process.stdout.write(`SUMMARY ${notes[0].replace(/\s+/g, " ")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
