import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = "http://localhost:3001";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let failed = 0;

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!pass) failed += 1;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(8000);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 60000 });
}

async function openProducts(page: Page) {
  await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "מלאי", exact: true }).click();
  await page.getByRole("button", { name: "מוצרים", exact: true }).click();
  await page.getByRole("columnheader", { name: "מקור" }).waitFor({ timeout: 20000 });
}

async function search(page: Page, text: string) {
  const input = page.getByPlaceholder("חיפוש לפי שם מאוחד או שם ספק");
  await input.fill(text);
  await sleep(300);
}

async function main() {
  if (!existsSync(CHROME)) throw new Error("chrome missing");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(page);
    await openProducts(page);
    record("source column and filter are visible", await page.getByRole("columnheader", { name: "מקור" }).count() === 1 && await page.locator("option[value='purchase-file']").count() === 1);

    await search(page, "כרעיים");
    const invoiceRow = page.locator("tr", { hasText: "כרעיים" }).first();
    await invoiceRow.waitFor({ timeout: 15000 });
    const before = await invoiceRow.locator("td.font-semibold").innerText();
    const summary = await invoiceRow.locator("[data-product-source]").innerText();
    record("invoice product summarizes the posted invoice", summary.includes("חשבונית 517083879") && !summary.includes("ללא כניסת מלאי"), summary.replace(/\s+/g, " "));
    await invoiceRow.getByRole("button", { name: "פרטי מקור" }).click();
    await page.getByRole("columnheader", { name: "כמות שנכנסה" }).waitFor();
    const dialog = await page.locator("table").last().innerText();
    record(
      "invoice details list the intake and the supplier document",
      dialog.includes("517083879") && dialog.includes("שיווק עופות") && /\d/.test(dialog) && dialog.includes("פתיחת החשבונית") && dialog.includes("פתיחת התנועה"),
      dialog.replace(/\s+/g, " ").slice(0, 400)
    );
    record("invoice details do not add a second intake", (dialog.match(/517083879/g) ?? []).length <= 3);
    await page.getByRole("button", { name: "פתיחת התנועה" }).click();
    await page.getByText("כרטסת מלאי").waitFor({ timeout: 15000 });
    const ledgerVisible = await page.locator("[id^='movement-']").count();
    record("opening the movement shows the ledger row", ledgerVisible > 0, String(ledgerVisible));
    await page.getByRole("button", { name: "מוצרים", exact: true }).click();
    await search(page, "כרעיים");
    const after = await page.locator("tr", { hasText: "כרעיים" }).first().locator("td.font-semibold").innerText();
    record("opening source details does not change the stock row", before === after);

    await search(page, "ממרח שקדים");
    const created = page.locator("tr", { hasText: "ממרח שקדים" }).first();
    await created.waitFor({ timeout: 15000 });
    const createdSummary = await created.locator("[data-product-source]").innerText();
    record("invoice-created product without stock is not shown as received goods", createdSummary.includes("נוצר מחשבונית") && !createdSummary.includes("כל התנועות"), createdSummary.replace(/\s+/g, " "));
    await created.getByRole("button", { name: "פרטי מקור" }).click();
    await page.getByText("אין כניסת מלאי").waitFor();
    const createdDialog = await page.locator("body").innerText();
    record("created invoice dialog has no received quantity row", createdDialog.includes("אין כניסת מלאי") && createdDialog.includes("מקור יצירת המוצר"));
    await page.keyboard.press("Escape");
    await sleep(200);

    await search(page, "בצל ירוק");
    const missing = page.locator("tr", { hasText: "בצל ירוק" }).first();
    await missing.waitFor({ timeout: 15000 });
    const missingSummary = await missing.locator("[data-product-source]").innerText();
    record("product without a saved link is undocumented", missingSummary.includes("מקור לא מתועד") && !missingSummary.includes("חשבונית"), missingSummary.replace(/\s+/g, " "));
    await missing.getByRole("button", { name: "פרטי מקור" }).click();
    await page.getByText("אין כניסת מלאי").waitFor();
    record("undocumented dialog does not invent a supplier intake", !(await page.getByRole("cell", { name: "שיווק עופות" }).count()));
    await page.keyboard.press("Escape");

    await search(page, "");
    await page.locator("select").filter({ has: page.locator("option[value='undocumented']") }).selectOption("invoice");
    await sleep(300);
    record("invoice filter keeps a posted invoice product", await page.locator("tr", { hasText: "כרעיים" }).count() > 0);
    record("invoice filter hides an undocumented product", await page.locator("tr", { hasText: "בצל ירוק" }).count() === 0);
    await page.locator("select").filter({ has: page.locator("option[value='undocumented']") }).selectOption("manual");
    await sleep(200);
    record("manual filter does not invent manual rows from invoice products", await page.locator("tr", { hasText: "כרעיים" }).count() === 0);

    await page.getByRole("button", { name: "العربية" }).click();
    await sleep(400);
    await page.locator("select").filter({ has: page.locator("option[value='undocumented']") }).selectOption("");
    await page.getByPlaceholder("بحث بالاسم الموحد أو اسم المورد").fill("כרעיים");
    await sleep(300);
    const arabic = await page.locator("tr", { hasText: "כרעיים" }).first().locator("[data-product-source]").innerText();
    record("arabic screen uses the arabic source label", arabic.includes("فاتورة"), arabic.replace(/\s+/g, " "));

    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    const card = page.locator("[data-product-source=''] , [data-product-source]").first();
    await page.locator("[data-product-source]").first().waitFor();
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    record("mobile source card stays inside the screen", width.scroll <= width.client + 1, `${width.scroll}/${width.client}`);
    await page.getByRole("button", { name: "تفاصيل المصدر" }).first().click();
    await page.getByRole("columnheader", { name: "الكمية الداخلة" }).waitFor();
    const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    record("mobile source dialog does not widen the page", mobileWidth);
    record("no page errors", errors.length === 0, errors.join(" | "));
    void card;
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
