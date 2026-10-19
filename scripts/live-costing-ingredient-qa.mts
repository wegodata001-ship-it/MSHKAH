import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright-core";
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
const OUT = "tmp/costing-ingredient-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function cleanupTestIngredients() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.ingredients).where("name", "==", "TEST שניצל").get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  return snap.size;
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(2500);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /התחבר|כניסה|Sign in|تسجيل/ }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
}

async function openIngredients(page: Page) {
  await page.getByRole("button", { name: /מאגר מרכיבים|Ingredients|المكونات/ }).click();
  await sleep(600);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await cleanupTestIngredients();

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1280,800"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "he-IL" });
  await context.addInitScript(() => {
    localStorage.setItem("mishkat-locale", "he");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message));

  try {
    await login(page);
    await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: /תמחור ועלויות/ }).first().waitFor({ timeout: 20000 });
    record("DESKTOP PAGE", true);

    await openIngredients(page);
    record("INGREDIENTS TAB", /מאגר מרכיבים/.test(await page.innerText("body")));

    await page.getByRole("button", { name: /הוספת מרכיב/ }).first().click();
    const dialog = page.locator('[data-slot="admin-modal-panel"]');
    await dialog.waitFor({ timeout: 10000 });
    record("MODAL OPEN", true);

    const inputs = dialog.locator("input");
    await inputs.nth(0).fill("TEST שניצל");
    await inputs.nth(1).fill("60");
    await inputs.nth(2).fill("2");
    await sleep(300);
    const modalText = await dialog.innerText();
    record("LIVE COST CALCULATION", /₪30\.00/.test(modalText) && /₪0\.0300/.test(modalText));
    record("NO RAW PERMISSION ERROR", !/Missing or insufficient permissions/i.test(await page.innerText("body")));

    await dialog.getByRole("button", { name: /שמירת מרכיב/ }).click();
    await dialog.getByText(/המרכיב נוסף בהצלחה/).waitFor({ timeout: 20000 });
    record("INGREDIENT CREATE", true);
    record(
      "QUICK ADD",
      (await dialog.getByRole("button", { name: /^סיום$/ }).count()) > 0 &&
        (await dialog.getByRole("button", { name: /הוספת מרכיב נוסף/ }).count()) > 0
    );

    await dialog.getByRole("button", { name: /הוספת מרכיב נוסף/ }).click();
    await dialog.getByRole("button", { name: /שמירת מרכיב/ }).waitFor({ timeout: 8000 });
    const nameAfter = await inputs.nth(0).inputValue();
    record("QUICK ADD CLEARS FORM", nameAfter === "");
    await dialog.getByRole("button", { name: /^ביטול$/ }).click();
    await sleep(800);

    const listText = await page.innerText("body");
    record("CARD SHOWS COST", /TEST שניצל/.test(listText) && /₪30\.00/.test(listText) && /₪0\.0300/.test(listText));
    await page.screenshot({ path: `${OUT}/desktop-list.png`, fullPage: true });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /תמחור ועלויות/ }).first().waitFor({ timeout: 20000 });
    await openIngredients(page);
    await page.getByText("TEST שניצל").first().waitFor({ timeout: 15000 });
    record("REFRESH PERSISTENCE", true);

    await page.locator("div").filter({ hasText: /^TEST שניצל/ }).getByRole("button", { name: /עריכה/ }).first().click();
    await dialog.waitFor({ timeout: 8000 });
    const prefilled = await dialog.locator("input").nth(1).inputValue();
    record("EDIT OPEN", prefilled === "60");
    await dialog.locator("input").nth(1).fill("70");
    await sleep(300);
    const editText = await dialog.innerText();
    record("EDIT LIVE CALC", /₪35\.00/.test(editText) && /₪0\.0350/.test(editText));
    await dialog.getByRole("button", { name: /שמירת מרכיב/ }).click();
    await sleep(3000);
    const afterEdit = await page.innerText("body");
    record(
      "INGREDIENT UPDATE",
      /₪35\.00/.test(afterEdit) && !/Missing or insufficient permissions/i.test(afterEdit)
    );

    await page.keyboard.press("Escape").catch(() => undefined);
    await sleep(400);
    await page.locator("button").filter({ hasText: /היסטוריית מחירים|Price history|سجل الأسعار/ }).first().click();
    await sleep(800);
    const historyText = await page.innerText("body");
    record("PRICE HISTORY", /₪60\.00/.test(historyText) && /₪70\.00/.test(historyText));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: /תמחור ועלויות/ }).first().waitFor({ timeout: 20000 });
    await openIngredients(page);
    await page.getByRole("button", { name: /הוספת מרכיב/ }).first().click();
    await dialog.waitFor({ timeout: 8000 });
    const mobileBox = await dialog.boundingBox();
    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    record(
      "MOBILE",
      Boolean(mobileBox && mobileBox.width >= 350 && !hasHScroll),
      mobileBox ? `w=${Math.round(mobileBox.width)} scroll=${hasHScroll}` : "no-modal"
    );
    await page.screenshot({ path: `${OUT}/mobile-390.png` });
  } finally {
    await browser.close();
    const removed = await cleanupTestIngredients();
    console.log("cleaned_test_ingredients", removed);
  }
}

main().catch((error) => {
  console.error("QA_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
