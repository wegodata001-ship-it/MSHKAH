import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Page } from "playwright-core";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const INVOICE_ID = "qa-click-1910";
const SUPPLIER_ID = "qa-supplier-click-1910";
const EXISTING_ID = "qa-click-existing-1910";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetFixture() {
  const db = getAdminDb();
  const moves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
  await Promise.all(moves.docs.map((doc) => doc.ref.delete()));
  const created = await db.collection(COLLECTIONS.ingredients).where("name", "in", ["בדיקת חסרה יחידה", "בדיקת לחיצה חדש"]).get();
  await Promise.all(created.docs.map((doc) => doc.ref.delete()));
  await db.collection(COLLECTIONS.inventoryBalances).doc(EXISTING_ID).set({ quantityBase: 0, updatedAt: FieldValue.serverTimestamp() });
  await db.collection(COLLECTIONS.suppliers).doc(SUPPLIER_ID).set({
    name: "בדיקת ספק לחיצה",
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection(COLLECTIONS.ingredients).doc(EXISTING_ID).set({
    name: "בדיקת קיים לחיצה",
    purchasePrice: 0,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    costPerBaseUnit: 0,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const row = (patch: Record<string, unknown>) => ({
    quantity: 1,
    unitPrice: 5,
    netAmount: 5,
    vatType: "inclusive",
    vatRate: 0.18,
    lineType: "INVENTORY_ITEM",
    skipInventory: false,
    postedToStock: false,
    ...patch,
  });
  await db.collection(COLLECTIONS.purchaseInvoices).doc(INVOICE_ID).set({
    supplierId: SUPPLIER_ID,
    supplierName: "בדיקת ספק לחיצה",
    invoiceNumber: "QA-CLICK-1910",
    invoiceDate: "2026-10-19",
    currency: "ILS",
    status: "draft",
    stockStatus: "none",
    scanStatus: "done",
    sourceFile: { kind: "image", name: "qa-click.png" },
    lines: [
      row({
        key: "click-missing",
        rawName: "בדיקת חסרה יחידה",
        originalDescription: "בדיקת חסרה יחידה",
        plannedProductName: "בדיקת חסרה יחידה",
        unit: null,
        matchKind: "new",
        matchConfirmed: true,
        sku: "QA-CLICK-MISS",
      }),
      row({
        key: "click-new",
        rawName: "בדיקת לחיצה חדש",
        originalDescription: "בדיקת לחיצה חדש",
        plannedProductName: "בדיקת לחיצה חדש",
        quantity: 2,
        netAmount: 10,
        unit: "unit",
        matchKind: "new",
        matchConfirmed: true,
        sku: "QA-CLICK-NEW",
      }),
      row({
        key: "click-existing",
        rawName: "בדיקת שיוך קיים",
        originalDescription: "בדיקת שיוך קיים",
        unit: "unit",
        productId: EXISTING_ID,
        matchKind: "mapped",
        matchConfirmed: true,
        sku: "QA-CLICK-EXISTING",
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
  if (await hebrew.count()) await hebrew.first().click();
  await sleep(400);
}

async function openInvoice(page: Page) {
  await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
  const search = page.getByPlaceholder("מספר חשבונית / ספק / מוצר / סכום");
  await search.waitFor({ timeout: 30000 });
  await search.fill("QA-CLICK-1910");
  await page.waitForFunction(() => {
    const cell = [...document.querySelectorAll("td")].find((td) => td.textContent?.includes("QA-CLICK-1910"));
    const row = cell?.closest("tr");
    return Boolean(row && [...row.querySelectorAll("button")].some((button) => button.textContent?.includes("עריכה")));
  }, { timeout: 30000 });
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll("td")].find((td) => td.textContent?.includes("QA-CLICK-1910"));
    const row = cell?.closest("tr");
    const button = [...(row?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.includes("עריכה"));
    (button as HTMLButtonElement | undefined)?.click();
  });
  await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).waitFor({ timeout: 20000 });
}

async function approveBox(page: Page) {
  const button = page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true });
  await button.scrollIntoViewIfNeeded();
  return button.boundingBox();
}

async function installObserver(page: Page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("אשר וקלוט למלאי") && item.getBoundingClientRect().width > 0);
    (window as unknown as { __sawChecking: boolean; __sawPosting: boolean }).__sawChecking = false;
    (window as unknown as { __sawPosting: boolean }).__sawPosting = false;
    if (!button) return;
    const obs = new MutationObserver(() => {
      const text = button.textContent ?? "";
      const flag = window as unknown as { __sawChecking: boolean; __sawPosting: boolean };
      if (text.includes("בודק נתונים")) flag.__sawChecking = true;
      if (text.includes("קולט למלאי")) flag.__sawPosting = true;
    });
    obs.observe(button, { subtree: true, childList: true, characterData: true });
  });
}

async function main() {
  if (!existsSync(CHROME)) throw new Error("chrome missing");
  await resetFixture();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 503, height: 900 }, hasTouch: true });
  await page.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let stockPosts = 0;
  await page.route("**/api/admin/inventory/invoice/stock-post", async (route) => {
    stockPosts += 1;
    const mode = (globalThis as { __stockMode?: string }).__stockMode ?? "block";
    if (mode === "deny") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "PERMISSION_DENIED", code: "PERMISSION_DENIED" }) });
      return;
    }
    if (mode === "empty") {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
      return;
    }
    if (mode === "live") {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
      return;
    }
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "blocked-before-ready" }) });
  });
  try {
    await login(page);
    const widths = [
      { width: 503, height: 900, input: "touch" as const },
      { width: 360, height: 740, input: "touch" as const },
      { width: 1440, height: 900, input: "mouse" as const },
    ];
    for (const viewport of widths) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openInvoice(page);
      const box = await approveBox(page);
      const hit = box
        ? await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            const button = el?.closest("button");
            const style = button ? getComputedStyle(button) : null;
            return {
              text: (button?.textContent ?? el?.textContent ?? "").trim().slice(0, 48),
              disabled: button instanceof HTMLButtonElement ? button.disabled : null,
              pointerEvents: style?.pointerEvents ?? null,
              type: button?.getAttribute("type") ?? null,
            };
          }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        : null;
      record(
        `${viewport.width}px hit target`,
        Boolean(hit && hit.text.includes("אשר וקלוט למלאי") && hit.disabled === false && hit.pointerEvents !== "none" && hit.type === "button"),
        hit ? JSON.stringify(hit) : "no box"
      );
      await installObserver(page);
      if (!box) continue;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (viewport.input === "touch") await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await page.getByText("הקליטה טרם התחילה").first().waitFor({ timeout: 8000 });
      const notice = await page.locator("#invoice-intake-notice").innerText();
      const phase = await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).getAttribute("data-intake-phase");
      const saw = await page.evaluate(() => (window as unknown as { __sawChecking?: boolean }).__sawChecking === true);
      const field = await page.evaluate(() => {
        const select = [...document.querySelectorAll<HTMLSelectElement>("#invoice-line-click-missing-unit")].find((node) => node.getBoundingClientRect().height > 0);
        const active = document.activeElement;
        return {
          ring: Boolean(select?.className.includes("ring-amber-500")),
          activeVisible: active instanceof HTMLElement && active.getBoundingClientRect().height > 0 && active.id === "invoice-line-click-missing-unit",
        };
      });
      record(`${viewport.width}px ${viewport.input} shows checking then the reason`, saw && notice.includes("חסרה יחידה") && notice.includes("בדיקת חסרה יחידה") && phase === "idle", `saw=${saw} phase=${phase}`);
      const blockerList = await page.locator("#invoice-intake-notice ul").innerText();
      const pageText = await page.locator("body").innerText();
      record(
        `${viewport.width}px new product is not a blocker`,
        pageText.includes("מוצר חדש — ייווצר וישויך באישור") && !blockerList.includes("בדיקת לחיצה חדש") && !blockerList.includes("חסר שיוך"),
        blockerList.replace(/\s+/g, " ").slice(0, 220)
      );
      record(`${viewport.width}px existing assignment is not a blocker`, !notice.includes("בדיקת שיוך קיים"));
      record(`${viewport.width}px scrolls to the visible unit field`, field.ring && field.activeVisible, JSON.stringify(field));
      record(`${viewport.width}px did not post stock`, stockPosts === 0, `posts=${stockPosts}`);
    }

    await page.setViewportSize({ width: 503, height: 900 });
    await page.evaluate(() => {
      const select = [...document.querySelectorAll<HTMLSelectElement>("#invoice-line-click-missing-unit")].find((node) => node.getBoundingClientRect().height > 0);
      if (!select) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "unit");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    (globalThis as { __stockMode?: string }).__stockMode = "deny";
    stockPosts = 0;
    await installObserver(page);
    await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).click();
    await page.getByText("שגיאת הרשאות מערכת").first().waitFor({ timeout: 30000 });
    const denyPhase = await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).getAttribute("data-intake-phase");
    const denyBody = await page.locator("body").innerText();
    record("permission failure stops the spinner and keeps the draft", denyPhase === "idle" && !denyBody.includes("הקליטה הושלמה"), `phase=${denyPhase} posts=${stockPosts}`);

    (globalThis as { __stockMode?: string }).__stockMode = "empty";
    await installObserver(page);
    await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).click();
    await page.getByText("התקבלה תשובה לא תקינה מהשרת").first().waitFor({ timeout: 30000 });
    const emptyPhase = await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).getAttribute("data-intake-phase");
    record("empty response stops the spinner", emptyPhase === "idle" && !(await page.locator("body").innerText()).includes("הקליטה הושלמה"));

    (globalThis as { __stockMode?: string }).__stockMode = "live";
    stockPosts = 0;
    await installObserver(page);
    const liveButton = page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true });
    await liveButton.click();
    await liveButton.click({ timeout: 1500 }).catch(() => undefined);
    await page.getByText("הקליטה הושלמה").first().waitFor({ timeout: 45000 });
    const body = await page.locator("body").innerText();
    const sawPosting = await page.evaluate(() => (window as unknown as { __sawPosting?: boolean }).__sawPosting === true);
    record("successful intake shows added quantities", body.includes("בדיקת לחיצה חדש") && body.includes("בדיקת קיים לחיצה") && body.includes("→"), `posting=${sawPosting}`);
    record("double click sends one stock request", stockPosts === 1, `posts=${stockPosts}`);

    const db = getAdminDb();
    const before = (await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get()).size;
    await page.getByRole("button", { name: "אשר וקלוט למלאי", exact: true }).click({ timeout: 5000 }).catch(() => undefined);
    await sleep(1500);
    const after = (await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get()).size;
    const postedNote = await page.locator("body").innerText();
    record("retry does not add stock", before > 0 && after === before && postedNote.includes("המסמך כבר נקלט למלאי"), `moves=${before}->${after}`);
    record("no page errors", errors.length === 0, errors.join(" | "));
  } catch (error) {
    record("flow", false, error instanceof Error ? error.message : String(error));
    record("no page errors", errors.length === 0, errors.join(" | "));
    await page.screenshot({ path: "tmp/intake-click-qa.png", fullPage: true }).catch(() => undefined);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
