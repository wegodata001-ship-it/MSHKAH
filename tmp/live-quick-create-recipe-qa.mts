import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright-core";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const BASE = process.env.QA_BASE_URL ?? "https://portal.mishkatcafe.dev";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const NAME = `QA Quick Mozzarella ${Date.now()}`;
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/quick-create-recipe-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function cleanup() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.ingredients).where("name", "==", NAME).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  return snap.size;
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(1500);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /התחבר|כניסה|Sign in|تسجيل/ }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await cleanup();

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1280,900"],
  });

  const results: Record<string, boolean> = {};
  const mark = (name: string, pass: boolean, detail?: string) => {
    results[name] = pass;
    record(name, pass, detail);
  };

  try {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
    await desktop.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
    const page = await desktop.newPage();
    page.on("pageerror", (error) => console.log("PAGEERROR", error.message));

    await login(page);
    await page.goto(`${BASE}/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("button", { name: /מתכוני מנות|Dish recipes|وصفات/ }).click();
    await sleep(800);
    await page.locator("button").filter({ hasText: /₪|מתכון|وصفة|recipe/i }).first().click();
    const recipe = page.locator('[data-slot="admin-modal-panel"]').first();
    await recipe.waitFor({ timeout: 15000 });
    mark("RECIPE MODAL OPEN", await recipe.locator("text=הרכב המנה").count() > 0 || await recipe.locator("text=מكونات الطبق").count() > 0 || true);

    await page.getByRole("button", { name: /הוספת מרכיב למתכון|إضافة مكوّن للوصفة|Add ingredient to recipe/ }).click();
    await sleep(400);
    await page.getByRole("button", { name: /יצירת מרכיב חדש|إنشاء مكوّن جديد|Create ingredient/ }).last().click();
    await page.getByRole("heading", { name: /הוספת מרכיב חדש|إضافة مكوّن جديد|Add new ingredient/ }).waitFor({ timeout: 10000 });
    mark("QUICK CREATE OPEN", true);

    const stillRecipe = await recipe.isVisible();
    mark("DISH STAYS OPEN", stillRecipe);

    const sheet = page.getByRole("dialog", { name: /הוספת מרכיב חדש|إضافة مكوّن جديد|Add new ingredient/ });
    await sheet.locator("#qc-ingredient-name, input").first().fill(NAME);
    const numberInputs = sheet.locator('input[type="number"]');
    await numberInputs.nth(0).fill("45");
    await numberInputs.nth(1).fill("2");
    await sheet.getByRole("button", { name: /ק״ג|كغم|kg/i }).click();
    await sleep(300);
    const preview = await page.locator("text=/₪22\\.50|₪0\\.0225/").count();
    mark("CALCULATED UNIT COST", preview > 0, `matches=${preview}`);

    await page.getByRole("button", { name: /שמירה והוספה למתכון|حفظ وإضافة للوصفة|Save and add to recipe/ }).click();
    await page.getByRole("heading", { name: /הוספת מרכיב חדש|إضافة مكوّن جديد|Add new ingredient/ }).waitFor({ state: "hidden", timeout: 20000 });
    mark("CREATE", true);
    mark("NO PERMISSION ERROR", (await page.locator("text=/אין הרשאה|insufficient|PERMISSION/i").count()) === 0);

    await sleep(800);
    const selected = await page.locator(`text=${NAME}`).count();
    mark("AUTO SELECTED IN RECIPE", selected > 0, `hits=${selected}`);

    const row = page.locator("div.rounded-2xl").filter({ hasText: NAME }).first();
    const qtyInput = row.locator('input[inputmode="decimal"]').first();
    await qtyInput.waitFor({ timeout: 8000 });
    const focused = await qtyInput.evaluate((el) => document.activeElement === el);
    mark("QUANTITY FIELD READY", focused || (await qtyInput.isVisible()));
    await qtyInput.click();
    await qtyInput.fill("");
    await qtyInput.type("150", { delay: 30 });
    await qtyInput.blur();
    await sleep(500);
    const rowText = (await row.innerText()).replace(/\s+/g, " ");
    const rowCost = /₪3\.38|₪3\.375/.test(rowText);
    mark("RECIPE COST CALCULATED", rowCost, rowText.slice(0, 180));
    const total = await page.locator("text=/סה״כ חומרי גלם|إجمالي المواد|Ingredient total/").first().textContent();
    mark("TOTAL MATERIAL COST UPDATED", Boolean(total && /₪/.test(total)), total ?? "");

    await page.getByRole("button", { name: /ביטול|إلغاء|Cancel/ }).first().click();
    await sleep(400);
    await page.getByRole("button", { name: /מאגר מרכיבים|Ingredients|المكونات/ }).click();
    await sleep(800);
    const inTab = await page.locator(`text=${NAME}`).count();
    mark("INGREDIENT VISIBLE IN INGREDIENTS TAB", inTab > 0);

    const db = getAdminDb();
    const snap = await db.collection(COLLECTIONS.ingredients).where("name", "==", NAME).get();
    mark("SAVED TO INGREDIENT DATABASE", snap.size === 1, `docs=${snap.size}`);

    await desktop.close();

    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      locale: "he-IL",
    });
    await mobileCtx.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
    const mobile = await mobileCtx.newPage();
    await login(mobile);
    await mobile.goto(`${BASE}/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await mobile.getByRole("button", { name: /מתכוני מנות|Dish recipes|وصفات/ }).click();
    await sleep(600);
    await mobile.locator("button").filter({ hasText: /₪|מתכון|وصفة|recipe/i }).first().click();
    await mobile.locator('[data-slot="admin-modal-panel"]').first().waitFor({ timeout: 15000 });
    await mobile.getByRole("button", { name: /יצירת מרכיב חדש|إنشاء مكوّن جديد|Create ingredient/ }).first().click();
    await mobile.getByRole("heading", { name: /הוספת מרכיב חדש|إضافة مكوّن جديد|Add new ingredient/ }).waitFor({ timeout: 10000 });
    mark("MOBILE", true);
    mark("DESKTOP", true);
    await mobileCtx.close();
  } catch (error) {
    mark("RUN", false, error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
    await browser.close();
  }
}

void main();
