import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync, mkdirSync } from "fs";
import { chromium } from "playwright-core";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/costing-ingredient-qa";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    locale: "he-IL",
  });
  await context.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
  const page = await context.newPage();
  await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle", timeout: 90000 });
  await sleep(2500);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /התחבר|התחברות|Sign In/ }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
  await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(4000);
  await page.locator("button").filter({ hasText: /מאגר מרכיבים/ }).first().click();
  await sleep(600);
  await page.locator("button").filter({ hasText: /הוספת מרכיב/ }).first().click();
  const dialog = page.locator('[data-slot="admin-modal-panel"]');
  await dialog.waitFor({ timeout: 10000 });
  const box = await dialog.boundingBox();
  const hasHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  const saveWide = await dialog.locator("button").filter({ hasText: /שמירת מרכיב/ }).boundingBox();
  console.log(
    "MOBILE",
    box && box.width >= 350 && !hasHScroll ? "PASS" : "FAIL",
    `w=${box ? Math.round(box.width) : 0}`,
    `h=${box ? Math.round(box.height) : 0}`,
    `scroll=${hasHScroll}`,
    `saveW=${saveWide ? Math.round(saveWide.width) : 0}`
  );
  await page.screenshot({ path: `${OUT}/mobile-390.png` });
  await browser.close();
}

main().catch((error) => {
  console.error("QA_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
