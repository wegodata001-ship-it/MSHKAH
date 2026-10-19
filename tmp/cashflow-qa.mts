import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = "http://localhost:3002";
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
  await sleep(2000);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 40000 });
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
    const cashTab = page.getByRole("button", { name: "תזרים מזומנים" });
    await cashTab.waitFor({ timeout: 20000 });
    await cashTab.click();
    await page.getByText("יתרת פתיחה").first().waitFor({ timeout: 20000 });
    await page.getByText("טוען…").waitFor({ state: "hidden", timeout: 15000 }).catch(() => undefined);
    await sleep(500);
    const cashText = await page.locator("body").innerText();
    record("cash flow tab opens", cashText.includes("תזרים מזומנים") && cashText.includes("סך תקבולים בתקופה") && cashText.includes("סך תשלומים בתקופה") && cashText.includes("יתרה צפויה לסוף התקופה"));
    const openingShown = cashText.includes("יש להשלים יתרת פתיחה ותאריך לפני חישוב היתרה");
    record("opening asks to be completed", openingShown, openingShown ? "" : cashText.slice(cashText.indexOf("יתרת פתיחה"), cashText.indexOf("יתרת פתיחה") + 280).replace(/\s+/g, " "));
    const month = page.locator("input[type=month]").first();
    await month.fill("2026-11");
    await sleep(300);
    record("month changes the date range", (await page.locator("input[type=date]").nth(0).inputValue()) === "2026-11-01" && (await page.locator("input[type=date]").nth(1).inputValue()) === "2026-11-30");
    record("forecast alone is a separate action from recording a payment", cashText.includes("הוספת תחזית") && cashText.includes("רישום תשלום") && cashText.includes("רישום תקבול") && cashText.includes("העברה פנימית"));

    await page.getByRole("button", { name: "נקודת איזון" }).click();
    await page.getByText("הוצאות קבועות").first().waitFor({ timeout: 20000 });
    const fixed = await page.locator("body").innerText();
    record(
      "fixed costs show payment columns",
      fixed.includes("תאריך התשלום הבא") && fixed.includes("תדירות תשלום") && fixed.includes("אמצעי תשלום או חשבון") && fixed.includes("תקופה לנקודת איזון")
    );
    const fixedTable = await page.locator("table").filter({ hasText: "תאריך התשלום הבא" }).innerText();
    record("undated expenses stay visible with an explanation", fixedTable.includes("חסר מועד תשלום") || fixedTable.includes("אין הוצאות קבועות"), fixedTable.includes("חסר מועד תשלום") ? "rows marked missing" : "no fixed costs");
    await page.getByRole("button", { name: "+ הוצאה קבועה" }).click();
    const paymentSelect = page.locator("select").filter({ hasText: "חד־פעמי" }).first();
    const options = await paymentSelect.locator("option").allTextContents();
    record(
      "payment form offers the five frequencies and a date",
      options.join(" ").includes("חד־פעמי") && options.join(" ").includes("דו־חודשי") && options.join(" ").includes("רבעוני") && options.join(" ").includes("שנתי") && (await page.locator("input[type=date]").count()) >= 2,
      options.join(" | ")
    );
    await page.getByRole("button", { name: "ביטול" }).first().click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "תזרים מזומנים" }).click();
    const mobile = await page.locator("body").innerText();
    record("cash flow stays reachable on a narrow screen", mobile.includes("יתרת פתיחה") && mobile.includes("רישום תשלום"));

    await page.setViewportSize({ width: 1440, height: 900 });
    const language = page.getByRole("button", { name: "العربية" });
    if ((await language.count()) === 0) {
      const labels = await page.locator("button").evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean).slice(0, 40));
      record("arabic cash flow labels", false, `language button missing: ${labels.join(" | ")}`);
      record("no page errors", errors.length === 0, errors.join(" | "));
      return;
    }
    await language.first().click();
    await page.getByRole("button", { name: "التدفق النقدي" }).click();
    await page.getByText("الرصيد الافتتاحي").first().waitFor({ timeout: 20000 });
    const arabic = await page.locator("body").innerText();
    record("arabic cash flow labels", arabic.includes("إجمالي المقبوضات في الفترة") && arabic.includes("تسجيل دفعة") && arabic.includes("تحويل داخلي"));
    await page.getByRole("button", { name: "نقطة التعادل" }).click();
    await page.getByText("تاريخ الدفعة التالية").first().waitFor({ timeout: 20000 });
    record("arabic fixed-cost payment labels", (await page.locator("body").innerText()).includes("تكرار الدفع"));
    record("no page errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
