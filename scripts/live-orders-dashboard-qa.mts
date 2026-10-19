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
const OUT = "tmp/orders-dashboard-qa";

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
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(800);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator('form button[type="submit"], button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1280,900"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
  await context.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
  const page = await context.newPage();

  try {
    await login(page);
    await page.goto(`${BASE}/orders`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: /الطلبات|הזמנות|Orders/ }).first().waitFor({ timeout: 25000 });
    await sleep(2500);
    const body = await page.innerText("body");
    record("DESKTOP PAGE", true);
    record("OVERDUE CARD", /طلبات متأخرة|הזמנות באיחור|Overdue/.test(body));
    record("121 MIN FORMAT", !/قبل 121 دقيقة|לפני 121 דקות|121 minutes ago/.test(body));
    record("6417 MIN FORMAT", !/قبل 6417 دقيقة|לפני 6417 דקות|6417 minutes ago/.test(body));
    record("HAS ORDERS OR EMPTY STATE", /MC-2026-|אין הזמנות|لا توجد|No orders/.test(body));
    await page.screenshot({ path: `${OUT}/desktop.png`, timeout: 15000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/orders`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(2000);
    const mobile = await page.innerText("body");
    record("MOBILE PAGE", /الطلبات|הזמנות|Orders/.test(mobile));
    record("MOBILE RAW MINUTES", !/قبل 6417 دقيقة|قبل 121 دقيقة/.test(mobile));
    await page.screenshot({ path: `${OUT}/mobile.png`, timeout: 15000 });
  } catch (error) {
    record("SUITE", false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: `${OUT}/error.png`, timeout: 10000 }).catch(() => undefined);
  } finally {
    writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }

  if (results.some((item) => !item.pass)) process.exit(1);
}

void main();
