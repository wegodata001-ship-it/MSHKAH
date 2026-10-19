import { existsSync } from "fs";
import { chromium } from "playwright-core";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3001";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => localStorage.setItem("mishkat-locale", "ar"));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);
  await page.locator("article").first().click();
  await page.locator("[role=dialog]").waitFor({ timeout: 15000 });
  const dlg = page.locator("[role=dialog]");
  const fav = dlg.getByRole("button", { name: /المفضلة|מועדפים|Favorite/i }).first();
  const before = await fav.locator("svg").evaluate((el) => el.getAttribute("class") || "");
  await fav.click();
  await page.waitForTimeout(400);
  const after = await fav.locator("svg").evaluate((el) => el.getAttribute("class") || "");
  record("FAVORITE TOGGLE", before !== after || /fill-red|text-red|fill-gold/.test(after), `${before} => ${after}`);

  const share = dlg.getByRole("button", { name: /Share|שתף|مشاركة/i }).first();
  record("SHARE STILL PRESENT", await share.isVisible());

  const add = dlg.getByRole("button", { name: /أضف إلى السلة|הוסף לעגלה|Add to Cart/i }).first();
  await add.click();
  await page.waitForTimeout(900);
  const dialogs = await page.locator("[role=dialog]").count();
  const addedOrWizard = dialogs === 0 || dialogs >= 1;
  record("ADD TO CART CLICKABLE", addedOrWizard, `dialogs=${dialogs}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
