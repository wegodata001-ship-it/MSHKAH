import { existsSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3001";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/product-close-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function openFirstProduct(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mishkat-locale", "ar");
    localStorage.setItem("mishkat-splash-seen", "1");
  });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(6000);
  await page.locator("#menu").scrollIntoViewIfNeeded().catch(() => undefined);
  const articles = page.locator("article");
  if ((await articles.count()) === 0) {
    const pills = page.locator("button");
    const n = await pills.count();
    for (let i = 0; i < Math.min(n, 24); i++) {
      const label = (await pills.nth(i).innerText().catch(() => "")).trim();
      if (!label || label.length > 40) continue;
      await pills.nth(i).click({ timeout: 800 }).catch(() => undefined);
      await sleep(800);
      if ((await articles.count()) > 0) break;
    }
  }
  await articles.first().waitFor({ state: "visible", timeout: 30000 });
  await articles.first().scrollIntoViewIfNeeded();
  await sleep(400);
  await articles.first().click();
  await page.locator("[role=dialog]").waitFor({ timeout: 15000 });
}

async function runViewport(label: string, width: number, height: number, page: Page) {
  await page.setViewportSize({ width, height });
  await openFirstProduct(page);

  const dialog = page.locator("[role=dialog]");
  const close = dialog.getByRole("button", { name: /إغلاق|סגור|Close/i }).first();
  const fav = dialog.getByRole("button", { name: /المفضلة|מועדפים|Favorite/i }).first();
  const share = dialog.getByRole("button", { name: /Share|שתף|مشاركة/i }).first();
  const add = dialog.getByRole("button", { name: /أضف إلى السلة|הוסף לעגלה|Add to Cart/i }).first();

  const closeBox = await close.boundingBox();
  const favBox = await fav.boundingBox().catch(() => null);
  const sizeOk = !!closeBox && closeBox.width >= 44 && closeBox.height >= 44;
  record(`${label} X size`, sizeOk, closeBox ? `${Math.round(closeBox.width)}x${Math.round(closeBox.height)}` : "missing");

  const opposite =
    !!closeBox &&
    !!favBox &&
    Math.abs(closeBox.x - favBox.x) > 40;
  record(`${label} X opposite favorite`, opposite);

  const scroll = dialog.locator(".overflow-y-auto").first();
  if ((await scroll.count()) > 0) {
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await sleep(200);
  }
  const stillVisible = await close.isVisible();
  record(`${label} X after inner scroll`, stillVisible);

  const pageY = await page.evaluate(() => window.scrollY);
  await close.click();
  await sleep(400);
  const closed = (await page.locator("[role=dialog]").count()) === 0;
  const pageYAfter = await page.evaluate(() => window.scrollY);
  record(`${label} X closes`, closed);
  record(`${label} scroll restored`, Math.abs(pageY - pageYAfter) < 80, `${pageY}→${pageYAfter}`);

  await openFirstProduct(page);
  await page.keyboard.press("Escape");
  await sleep(300);
  record(`${label} ESC close`, (await page.locator("[role=dialog]").count()) === 0);

  await openFirstProduct(page);
  record(`${label} favorite present`, await fav.isVisible());
  record(`${label} share present`, await share.isVisible());
  record(`${label} add to cart present`, await add.isVisible());
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: false });
  await page.keyboard.press("Escape");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await runViewport("MOBILE", 390, 844, page);
    await runViewport("TABLET", 768, 1024, page);
    await runViewport("DESKTOP", 1280, 800, page);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
