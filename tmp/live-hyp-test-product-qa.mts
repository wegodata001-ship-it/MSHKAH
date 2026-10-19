import { existsSync, mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright-core";

const BASE = "https://mishkatcafe.dev";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/hyp-test-product-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.addInitScript(() => {
      localStorage.setItem("mishkat-locale", "ar");
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(() => localStorage.removeItem("mishkat-cart-v2"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4000);

    const clickedTest = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const test = buttons.find((b) => (b.textContent || "").includes("TEST"));
      if (!test) return false;
      test.click();
      return true;
    });
    record("test category visible", clickedTest);
    await sleep(1500);

    const productCard = page.locator("article").filter({ hasText: "منتج اختبار الدفع" }).first();
    const found = await productCard.count();
    record("test product visible", found > 0);
    if (found === 0) {
      const body = await page.locator("body").innerText();
      writeFileSync(`${OUT}/home.txt`, body);
      await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });
      return;
    }

    await productCard.click();
    await sleep(2000);
    await page.screenshot({ path: `${OUT}/product.png`, fullPage: true });
    const addClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const add = buttons.find((b) => /أضف إلى السلة|הוסף לעגלה|Add to Cart|2\.00/.test(b.textContent || ""));
      if (!add) return false;
      add.click();
      return true;
    });
    record("add clicked", addClicked);
    await sleep(1200);
    const cart = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("mishkat-cart-v2") || "null");
      } catch {
        return null;
      }
    });
    const cartCount = Array.isArray(cart?.items) ? cart.items.length : 0;
    const cartPrice = cart?.items?.[0]?.unitPrice ?? cart?.items?.[0]?.product?.price;
    record("cart has item", cartCount === 1, `count=${cartCount} price=${cartPrice}`);

    await page.goto(`${BASE}/checkout`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/checkout.png`, fullPage: true });
    const text = await page.locator("body").innerText();
    writeFileSync(`${OUT}/checkout.txt`, text);
    await page.screenshot({ path: `${OUT}/checkout.png`, fullPage: true });

    record("checkout product", /منتج اختبار الدفع|מוצר בדיקת תשלום/.test(text));
    record("checkout total 2.00", /2\.00\s*₪|₪\s*2\.00/.test(text) && !/36\.00/.test(text));
    record("cash visible", /نقداً/.test(text));
    record("card visible", /بطاقة ائتمان/.test(text));
    record("card selectable", /بطاقة ائتمان/.test(text) && !/الدفع بالبطاقة غير متاح/.test(text));

    const status = await page.evaluate(async () => {
      const res = await fetch("/api/payments/hyp/status");
      return res.json();
    });
    record("hyp enabled", status?.enabled === true, JSON.stringify(status));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
