import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3002";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(2000);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
}

async function openCompare(page: Page) {
  await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "השוואת ספקים" }).first().click();
  await page.locator("select").first().waitFor({ timeout: 20000 });
}

async function chooseGroup(page: Page, name: string) {
  const select = page.locator("select").first();
  const value = await select.locator("option", { hasText: name }).first().getAttribute("value");
  if (!value) throw new Error(`missing group ${name}`);
  await select.selectOption(value);
  await sleep(400);
}

async function main() {
  if (!existsSync(CHROME)) throw new Error("chrome missing");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await page.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(page);
    await openCompare(page);
    await chooseGroup(page, "מאפיים");
    const body = await page.locator("body").innerText();
    const pastryRow = await page.locator("tr", { hasText: "מאפה פתוח" }).first().innerText();
    record("single product is not crowned", body.includes("נוסף מוצר אחד לקבוצה") && !pastryRow.includes("הזול ביותר"), pastryRow.replace(/\s+/g, " ").slice(0, 180));
    record("net heading and saved-purchase date", body.includes("המחירים לפני מע״מ") && body.includes("השוואה לפי הרכישות שנשמרו") && body.includes("2026-10-13"));
    record("table shows the stored net pack price", body.includes("244.80") && body.includes("6.12") && !body.includes("288.86"));
    record("history is not expanded under the table", await page.getByRole("dialog").count() === 0);

    await page.getByRole("button", { name: "פרטי השוואה" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const dialogText = await dialog.innerText();
    record(
      "dialog formula uses the stored 40 units",
      dialogText.includes("244.80 ÷ 40 = 6.12") && dialogText.includes("לפני מע״מ") && dialogText.includes("מאפה פתוח") && dialogText.includes("בריוש") && dialogText.includes("מאפיים")
    );
    record(
      "288.86 is labeled as the stored gross amount",
      dialogText.includes("288.86") && dialogText.includes("44.06") && dialogText.includes("סכום המע״מ שנשמר")
    );
    record("history pack price stays on the net basis", (await dialog.locator("table").innerText()).includes("244.80") && !(await dialog.locator("table").innerText()).includes("288.86"));

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    record("escape closes the dialog", true);
    await page.getByRole("button", { name: "פרטי השוואה" }).first().click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "hidden" });
    record("close button closes the dialog", true);
    await page.getByRole("button", { name: "פרטי השוואה" }).first().click();
    await dialog.waitFor();
    await page.mouse.click(8, 8);
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    record("outside click closes the dialog", true);

    await page.getByRole("button", { name: "כולל מע״מ", exact: true }).click();
    await page.getByText("המחירים כולל מע״מ").waitFor();
    const gross = await page.locator("tr", { hasText: "מאפה פתוח" }).first().innerText();
    record("gross mode shows 288.86 in the table", gross.includes("288.86") && gross.includes("7.22"), gross.replace(/\s+/g, " ").slice(0, 180));
    await page.getByRole("button", { name: "לפני מע״מ" }).click();

    await chooseGroup(page, "חסה");
    const lettuceTable = await page.locator("table").first().innerText();
    const lettuceBody = await page.locator("body").innerText();
    record(
      "two products without a shared basis are not crowned",
      lettuceTable.includes("חסה") && !lettuceTable.split("\n").some((line) => line.trim() === "הזול ביותר") && (lettuceBody.includes("חסר ספק / מחיר רכישה") || lettuceBody.includes("אי אפשר לסמן זול ביותר") || lettuceBody.includes("השלמה")),
      lettuceTable.replace(/\s+/g, " ").slice(0, 240)
    );

    await page.setViewportSize({ width: 503, height: 900 });
    await chooseGroup(page, "מאפיים");
    await page.getByRole("button", { name: "פרטי השוואה" }).first().click();
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    record("mobile dialog fits the screen", Boolean(box && box.width <= 503 && box.x >= 0), box ? `w=${Math.round(box.width)} x=${Math.round(box.x)}` : "no box");
    await page.touchscreen.tap(12, 12);
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    record("touch outside closes the dialog", true);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole("button", { name: "פרטי השוואה" }).first().click();
    await dialog.waitFor();
    const narrow = await dialog.boundingBox();
    record("narrow dialog fits", Boolean(narrow && narrow.width <= 360 && narrow.width > 200), narrow ? `w=${Math.round(narrow.width)}` : "no box");
    await page.keyboard.press("Escape");
    record("no page errors", errors.length === 0, errors.join(" | "));
  } catch (error) {
    record("flow", false, error instanceof Error ? error.message : String(error));
    record("no page errors", errors.length === 0, errors.join(" | "));
    await page.screenshot({ path: "tmp/compare-display-qa.png", fullPage: true }).catch(() => undefined);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
