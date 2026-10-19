import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = "http://localhost:3001";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

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
  await sleep(4000);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 60000 });
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
    await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "כספים" }).first().click();
    await page.getByRole("button", { name: "נקודת איזון" }).click();
    await page.getByText("כמה צריך למכור כדי לכסות את ההוצאות?").waitFor({ timeout: 20000 });
    await page.getByText("הוצאות קבועות").first().waitFor({ timeout: 20000 });
    const text = await page.locator("body").innerText();
    record(
      "variable cost entry area is gone",
      !text.includes("+ עלות משתנה") && !text.includes("אחוז מהמכירות") && !text.includes("אין עלויות משתנות") && (await page.locator("#be-variable").count()) === 0
    );
    record("fixed costs and payment dates remain", text.includes("הוצאות קבועות") && text.includes("תאריך התשלום הבא") && text.includes("תדירות תשלום"));
    record(
      "break-even figures and gaps stay visible",
      text.includes("יעד מכירות לנקודת איזון") && text.includes("מכירות בפועל בתקופה") && (text.includes("סכום שנותר לכיסוי ההוצאות") || text.includes("נתונים חסרים לחישוב מלא"))
    );
    await page.getByRole("button", { name: "החודש" }).click();
    await sleep(400);
    const settings = page.locator("details").filter({ hasText: "הגדרות חישוב" }).first();
    const fixedBox = await page.locator("#be-fixed").boundingBox();
    const settingsBox = await settings.boundingBox();
    const gap = fixedBox && settingsBox ? Math.round(settingsBox.y - (fixedBox.y + fixedBox.height)) : -1;
    record("spacing after the removed section", gap >= 8 && gap <= 40, `${gap}px`);
    await settings.locator("summary").click();
    await page.getByText("ימי פעילות בחודש").first().waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "תזרים מזומנים" }).click();
    await page.getByText("יתרת פתיחה").first().waitFor({ timeout: 20000 });
    record("cash flow screen remains", true);
    record("no page errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
