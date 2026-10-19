import { existsSync, mkdirSync, writeFileSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = "https://mishkatcafe.dev";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/hyp-checkout-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function seedCartScript() {
  const now = new Date().toISOString();
  const product = {
    id: "qa-hyp-product",
    name_he: "בדיקה",
    name_ar: "اختبار",
    name_en: "QA",
    description_he: "",
    description_ar: "",
    description_en: "",
    categoryId: "qa",
    price: 36,
    cost: 0,
    profit: 36,
    businessType: "beverage",
    image: "",
    isPopular: false,
    isNew: false,
    available: true,
    active: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem("mishkat-locale", "ar");
  localStorage.setItem(
    "mishkat-cart-v2",
    JSON.stringify({
      items: [
        {
          lineId: "qa-hyp-line",
          product,
          quantity: 1,
          selections: [],
          unitPrice: 36,
          configurable: false,
        },
      ],
      couponCode: "",
      couponDiscount: 0,
    })
  );
}

async function inspectCheckout(page: Page, label: string) {
  await page.addInitScript(seedCartScript);
  await page.goto(`${BASE}/checkout`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("طريقة الدفع", { exact: false }).waitFor({ timeout: 20000 }).catch(() => undefined);
  await sleep(1500);
  const text = await page.locator("body").innerText();
  writeFileSync(`${OUT}/${label}.txt`, text);
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });

  const cash = /نقداً/.test(text);
  const card = /بطاقة ائتمان/.test(text);
  const hint = /دفع آمن بواسطة HYP/.test(text);
  const unavailable = /الدفع بالبطاقة غير متاح/.test(text);
  const cashBtn = /تأكيد الطلب/.test(text);
  const empty = /السلة فارغة|cart.empty/.test(text);

  const cashBox = await page.locator("button", { hasText: "نقداً" }).first().boundingBox().catch(() => null);
  const cardBox = await page.locator("button", { hasText: "بطاقة ائتمان" }).first().boundingBox().catch(() => null);
  const heights = [cashBox?.height ?? 0, cardBox?.height ?? 0];
  const stacked = Boolean(cashBox && cardBox && Math.abs(cashBox.y - cardBox.y) > 20);
  const sideBySide = Boolean(cashBox && cardBox && Math.abs(cashBox.y - cardBox.y) < 20 && Math.abs(cashBox.x - cardBox.x) > 40);

  record(`${label} checkout not empty`, !empty);
  record(`${label} cash visible`, cash);
  record(`${label} card visible`, card);
  record(`${label} card hint`, hint);
  record(`${label} unavailable message`, unavailable);
  record(`${label} cash button`, cashBtn);
  record(`${label} touch height`, heights.every((h) => h >= 44), heights.join("/"));
  if (label === "mobile") {
    record(`${label} stacked`, stacked);
  } else {
    record(`${label} row or stacked`, sideBySide || stacked, sideBySide ? "row" : stacked ? "stacked" : "unknown");
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await inspectCheckout(desktop, "desktop");

    const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await inspectCheckout(tablet, "tablet");

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await inspectCheckout(mobile, "mobile");

    const success = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await success.addInitScript(() => localStorage.setItem("mishkat-locale", "ar"));
    await success.goto(`${BASE}/payment/success?order=MC-TEST&amount=36`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await success.getByText("تم", { exact: false }).waitFor({ timeout: 15000 }).catch(() => undefined);
    await sleep(800);
    const successText = await success.locator("body").innerText();
    writeFileSync(`${OUT}/success.txt`, successText);
    await success.screenshot({ path: `${OUT}/success.png`, fullPage: true });
    record("success title", /تم الدفع بنجاح/.test(successText));
    record("success hint", /تم استلام طلبك بنجاح/.test(successText));
    record("success no secrets", !/PassP|API_KEY|signature|Masof/i.test(successText));

    const failed = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await failed.addInitScript(() => localStorage.setItem("mishkat-locale", "ar"));
    await failed.goto(`${BASE}/payment/failed?reason=cancelled`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await failed.getByText("لم", { exact: false }).waitFor({ timeout: 15000 }).catch(() => undefined);
    await sleep(800);
    const failedText = await failed.locator("body").innerText();
    writeFileSync(`${OUT}/failed.txt`, failedText);
    await failed.screenshot({ path: `${OUT}/failed.png`, fullPage: true });
    record("failed title", /لم تكتمل عملية الدفع/.test(failedText));
    record("failed retry", /إعادة محاولة الدفع/.test(failedText));
    record("failed cart", /العودة إلى السلة/.test(failedText));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
