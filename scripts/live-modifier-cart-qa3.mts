import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { chromium } from "playwright-core";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3002", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("mishkat-locale", "he");
    localStorage.setItem("mishkat-cart-v2", JSON.stringify({ items: [], couponCode: "", couponDiscount: 0 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.goto("http://localhost:3002/#menu", { waitUntil: "domcontentloaded" });
  await sleep(3500);

  // expand categories
  const showAll = page.getByRole("button", { name: /הצג הכל/ });
  if (await showAll.count()) {
    await showAll.first().click();
    await sleep(800);
  }

  // hot drinks
  await page.getByRole("button", { name: /שתייה חמה/ }).first().click();
  await sleep(1500);

  // Click the + button on first product that has preview (opens builder via onClick)
  const clicked = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll("article"));
    for (const art of articles) {
      if (!art.querySelector(".pointer-events-none.select-none")) continue;
      const plus = Array.from(art.querySelectorAll("button")).find((b) =>
        /הוסף לעגלה|Add to Cart|أضف/i.test(b.getAttribute("aria-label") || "")
      ) as HTMLButtonElement | undefined;
      if (!plus) continue;
      plus.click();
      return art.querySelector("h3")?.textContent?.trim() || "unknown";
    }
    return null;
  });
  console.log("OPENED_VIA_PLUS", clicked);
  await sleep(2000);

  const dialog = await page.evaluate(() => {
    // prefer largest open panel that looks like product drawer
    const candidates = Array.from(
      document.querySelectorAll('[role="dialog"], [data-state="open"]')
    ) as HTMLElement[];
    const d =
      candidates
        .map((el) => ({ el, area: el.getBoundingClientRect().width * el.getBoundingClientRect().height }))
        .sort((a, b) => b.area - a.area)[0]?.el || null;
    if (!d) return null;
    return {
      snippet: (d.textContent || "").replace(/\s+/g, " ").slice(0, 500),
      buttons: Array.from(d.querySelectorAll("button")).map((b) => ({
        t: (b.textContent || "").trim().slice(0, 60),
        disabled: (b as HTMLButtonElement).disabled,
        aria: b.getAttribute("aria-label"),
      })),
    };
  });
  console.log("DIALOG_SNIPPET", dialog?.snippet);
  console.log(
    "DIALOG_BUTTONS",
    JSON.stringify(dialog?.buttons?.filter((b) => b.t || b.aria).slice(0, 40), null, 2)
  );

  // select first available option chips in each group-ish
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('[role="dialog"], [data-state="open"]')
    ) as HTMLElement[];
    const d = candidates.sort(
      (a, b) =>
        b.getBoundingClientRect().width * b.getBoundingClientRect().height -
        a.getBoundingClientRect().width * a.getBoundingClientRect().height
    )[0];
    if (!d) return;
    let selected = 0;
    for (const b of Array.from(d.querySelectorAll("button"))) {
      const t = (b.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (/הוס|לסל|Add|סגור|Close|×|נגיש/i.test(t)) continue;
      if (/A\+|A−|בהיר|כהה|רגיל|בינוני|גדול|איפוס/i.test(t) && selected === 0 && /נגיש|Focus|אפור/.test(d.textContent || "")) {
        // skip accessibility panel leftovers
      }
      (b as HTMLButtonElement).click();
      selected++;
      if (selected >= 6) break;
    }
  });
  await sleep(800);

  const addResult = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('[role="dialog"], [data-state="open"]')
    ) as HTMLElement[];
    const d = candidates.sort(
      (a, b) =>
        b.getBoundingClientRect().width * b.getBoundingClientRect().height -
        a.getBoundingClientRect().width * a.getBoundingClientRect().height
    )[0];
    const add = Array.from(d?.querySelectorAll("button") || []).find((b) =>
      /הוס|לסל|Add to/i.test((b.textContent || "") + (b.getAttribute("aria-label") || ""))
    ) as HTMLButtonElement | undefined;
    const state = { found: !!add, disabled: add?.disabled ?? null, text: add?.textContent?.trim() };
    if (add && !add.disabled) add.click();
    return state;
  });
  console.log("ADD", addResult);
  await sleep(1500);

  const cart = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("mishkat-cart-v2") || "null");
    } catch {
      return null;
    }
  });
  console.log("CART", JSON.stringify(cart, null, 2));

  await page.goto("http://localhost:3002/cart", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  console.log("CART_UI", (await page.locator("body").innerText()).slice(0, 600));

  await page.goto("http://localhost:3002/checkout", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  console.log("CHECKOUT_UI", (await page.locator("body").innerText()).slice(0, 600));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
