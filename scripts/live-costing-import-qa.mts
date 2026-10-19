import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.QA_BASE_URL ?? "https://portal.mishkatcafe.dev";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/costing-import-qa";

const results: { name: string; pass: boolean; detail?: string }[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  const loginPath = BASE.includes("portal.") ? "/login" : "/admin/login";
  await page.goto(`${BASE}${loginPath}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(800);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /התחבר|כניסה|Sign in|تسجيل/ }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
}

async function openIngredients(page: Page) {
  await page.getByRole("button", { name: /מאגר מרכיבים|Ingredients|مخزون المكونات/ }).click();
  await sleep(700);
}

async function runViewport(page: Page, label: "DESKTOP" | "MOBILE") {
  const costingPath = BASE.includes("portal.") ? "/costing" : "/admin/costing";
  await page.goto(`${BASE}${costingPath}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("heading", { name: /תמחור ועלויות|Pricing|التسعير/ }).first().waitFor({ timeout: 25000 });
  record(`${label} PAGE`, true);

  await openIngredients(page);
  const body = await page.innerText("body");
  record(`${label} IMPORT BUTTON`, /העלאת קובץ Excel|Upload Excel file|رفع ملف Excel/.test(body));
  record(`${label} TEMPLATE BUTTON`, /הורדת תבנית Excel|Download Excel template|تحميل نموذج Excel/.test(body));
  record(`${label} MENU EXPORT BUTTON`, /הורדת קובץ מוצרים קיים|Download current products|تحميل ملف المنتجات الحالي/.test(body));
  record(`${label} MENU DRAFT HIDDEN`, !/יצירת טיוטה מהתפריט|Generate draft from menu|إنشاء مسودة من القائمة|מילוי אוטומטי לפי מרכיבי/.test(body));

  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: /הורדת תבנית Excel|Download Excel template|تحميل نموذج Excel/ }).first().click();
  const download = await downloadPromise;
  const templatePath = `${OUT}/${label.toLowerCase()}-template.xlsx`;
  await download.saveAs(templatePath);
  record("EXCEL TEMPLATE DOWNLOAD", download.suggestedFilename().endsWith(".xlsx"), download.suggestedFilename());

  const menuDownloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: /הורדת קובץ מוצרים קיים|Download current products|تحميل ملف المنتجات الحالي/ }).first().click();
  const menuDownload = await menuDownloadPromise;
  record("CURRENT MENU EXPORT", menuDownload.suggestedFilename().endsWith(".xlsx"), menuDownload.suggestedFilename());

  await page.getByRole("button", { name: /העלאת קובץ Excel|Upload Excel file|رفع ملف Excel/ }).first().click();
  const dialog = page.locator('[data-slot="admin-modal-panel"]');
  await dialog.waitFor({ timeout: 10000 });
  const dialogText = await dialog.innerText();
  record("WIZARD OPEN", /1\.|העלאה|Upload|رفع الملف/.test(dialogText));

  if (label === "DESKTOP") {
    await page.locator('input[type="file"]').setInputFiles(templatePath);
    await sleep(1500);
    const parsed = await dialog.innerText();
    record("XLSX IMPORT", /מרכיבים|Ingredients|المكونات/.test(parsed) && /מנות|Dishes|الأطباق/.test(parsed));
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.getByRole("button", { name: /העלאת קובץ Excel|Upload Excel file|رفع ملف Excel/ }).first().click();
    await dialog.waitFor({ timeout: 10000 });
    const csvPath = `${OUT}/ingredients.csv`;
    writeFileSync(
      csvPath,
      "ingredient_name,category,supplier,purchase_price,package_quantity,purchase_unit\nبطاطا,مجمدات,B,92,10,kg\n"
    );
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await sleep(1500);
    record("CSV IMPORT", /بطاطا|מרכיבים|Ingredients|المكونات/.test(await dialog.innerText()));
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.getByRole("button", { name: /העלאת קובץ Excel|Upload Excel file|رفع ملف Excel/ }).first().click();
    await dialog.waitFor({ timeout: 10000 });
  }

  const wizardText = await dialog.innerText();
  record("WIZARD NO MENU AUTO-FILL", !/יצירת טיוטה מהתפריט|Generate draft from menu|إنشاء مسودة من القائمة/.test(wizardText));

  await page.screenshot({ path: `${OUT}/${label.toLowerCase()}.png`, timeout: 15000 });
  await page.getByRole("button", { name: /סגירה|Close|إغلاق|×/ }).first().click().catch(async () => {
    await page.keyboard.press("Escape");
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1280,900"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "he-IL",
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    localStorage.setItem("mishkat-locale", "he");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message));

  try {
    await login(page);
    await runViewport(page, "DESKTOP");
    await page.setViewportSize({ width: 390, height: 844 });
    await runViewport(page, "MOBILE");
  } catch (error) {
    record("SUITE", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: `${OUT}/error.png`, timeout: 10000 }).catch(() => undefined);
  } finally {
    writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }

  const failed = results.filter((item) => !item.pass);
  if (failed.length) process.exit(1);
}

void main();
