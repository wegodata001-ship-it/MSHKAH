import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { chromium } from "playwright-core";
import { existsSync } from "fs";

const CHROME = existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3002";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("mishkat-locale", "he");
    localStorage.removeItem("mishkat-cart-v2");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.goto(`${BASE}/#menu`, { waitUntil: "domcontentloaded" });
  await sleep(3500);

  // open salads category
  const buttons = page.locator("button");
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const t = ((await buttons.nth(i).innerText().catch(() => "")) || "").trim();
    if (t.includes("סלט")) {
      await buttons.nth(i).click();
      console.log("CLICKED_CAT", t);
      break;
    }
  }
  await sleep(1500);

  // click Caesar salad card body (not + button)
  const pos = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) =>
      (a.textContent || "").includes("קיסר")
    );
    if (!art) return null;
    const h3 = art.querySelector("h3");
    const r = (h3 || art).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  console.log("CARD_POS", pos);
  if (!pos) throw new Error("salad not found");
  await page.mouse.click(pos.x, pos.y);
  await sleep(2000);

  const dialogInfo = await page.evaluate(() => {
    const d =
      document.querySelector('[role="dialog"]') ||
      document.querySelector("[data-state='open']");
    if (!d) return { open: false };
    const text = (d.textContent || "").replace(/\s+/g, " ").slice(0, 400);
    const buttons = Array.from(d.querySelectorAll("button")).map((b) => ({
      text: (b.textContent || "").trim().slice(0, 40),
      disabled: (b as HTMLButtonElement).disabled,
    }));
    return { open: true, text, buttons: buttons.slice(0, 30) };
  });
  console.log("DIALOG", JSON.stringify(dialogInfo, null, 2));

  // select size large + chicken if present
  await page.evaluate(() => {
    const d =
      document.querySelector('[role="dialog"]') ||
      document.querySelector("[data-state='open']");
    if (!d) return;
    for (const b of Array.from(d.querySelectorAll("button"))) {
      const t = (b.textContent || "").trim();
      if (t.includes("גדול") || t.includes("חזה") || t.includes("עוף")) {
        (b as HTMLButtonElement).click();
      }
    }
  });
  await sleep(800);

  const addState = await page.evaluate(() => {
    const d =
      document.querySelector('[role="dialog"]') ||
      document.querySelector("[data-state='open']");
    const add = Array.from(d?.querySelectorAll("button") || []).find((b) =>
      /הוס|לסל|Add/i.test(b.textContent || "")
    ) as HTMLButtonElement | undefined;
    return {
      found: Boolean(add),
      disabled: add?.disabled ?? null,
      text: add?.textContent?.trim() ?? null,
    };
  });
  console.log("ADD_STATE", addState);

  if (addState.found && !addState.disabled) {
    await page.evaluate(() => {
      const d =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-state='open']");
      const add = Array.from(d?.querySelectorAll("button") || []).find((b) =>
        /הוס|לסל|Add/i.test(b.textContent || "")
      ) as HTMLButtonElement | undefined;
      add?.click();
    });
    await sleep(1500);
  }

  const cart = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("mishkat-cart-v2") || "null");
    } catch {
      return null;
    }
  });
  console.log("CART", JSON.stringify(cart, null, 2));

  await page.goto(`${BASE}/cart`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  console.log("CART_PAGE", (await page.locator("body").innerText()).slice(0, 500));

  await page.goto(`${BASE}/checkout`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  console.log("CHECKOUT_PAGE", (await page.locator("body").innerText()).slice(0, 500));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
