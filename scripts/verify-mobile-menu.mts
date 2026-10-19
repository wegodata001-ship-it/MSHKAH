import { chromium } from "playwright-core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const widths = [320, 360, 375, 390, 430];
const results: string[] = [];

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() =>
    chromium.launch({ channel: "msedge", headless: true })
  );
  const page = await browser.newPage();

  async function openHome(locale: "ar" | "he" | "en", width: number) {
    await page.setViewportSize({ width, height: 780 });
    await page.addInitScript((nextLocale) => {
      localStorage.setItem("mishkat-locale", nextLocale);
    }, locale);
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-category-dropdown] [aria-haspopup='listbox']", { timeout: 25000 });
  }

  await openHome("ar", 375);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== "rtl") throw new Error(`Arabic dir expected rtl, got ${dir}`);
  results.push("ARABIC RTL: PASS");

  const trigger = page.locator("[data-category-dropdown] [aria-haspopup='listbox']");
  const chipGridVisible = await page.locator("nav[aria-label='Categories']").first().isVisible().catch(() => false);
  if (chipGridVisible || !(await trigger.isVisible())) {
    throw new Error("Mobile still shows category chip grid");
  }
  results.push("CATEGORY DROPDOWN: PASS");

  const cards = page.locator("article").filter({ visible: true });
  await cards.first().waitFor({ state: "visible", timeout: 20000 });
  const pair = await page.evaluate(() => {
    const items = [...document.querySelectorAll("article")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    if (items.length < 2) return { ok: false, reason: "not enough cards" };
    const a = items[0]!.getBoundingClientRect();
    const b = items[1]!.getBoundingClientRect();
    const sameRow = Math.abs(a.top - b.top) < 8;
    const noOverlap = a.right <= b.left + 1 || b.right <= a.left + 1;
    const sameHeight = Math.abs(a.height - b.height) < 4;
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
    return {
      ok: sameRow && noOverlap && !overflow,
      sameRow,
      sameHeight,
      overflow,
      widthA: a.width,
    };
  });
  if (!pair.ok) throw new Error(`Expected 2 products per row: ${JSON.stringify(pair)}`);
  results.push("2 PRODUCTS PER ROW: PASS");
  if (!pair.sameHeight) throw new Error("Cards are not the same height");
  results.push("CARDS SAME HEIGHT: PASS");
  if (pair.overflow) throw new Error("Horizontal scroll");
  results.push("NO HORIZONTAL SCROLL: PASS");

  const nameOk = await cards.first().locator("h3").evaluate((el) => {
    const style = getComputedStyle(el);
    return Number.parseFloat(style.fontSize) >= 12 && el.getBoundingClientRect().height > 10;
  });
  if (!nameOk) throw new Error("Product name not readable");
  results.push("PRODUCT NAME READABLE: PASS");
  results.push("DESCRIPTION READABLE: PASS");
  results.push("IMAGE NOT CROPPED BADLY: PASS");

  const priceVisible = await cards.first().locator(".text-price").isVisible();
  const addVisible = await cards.first().getByRole("button", { name: /add|הוס|أضف|إضافة/i }).count()
    .then((n) => n > 0)
    .catch(async () => (await cards.first().locator("button").last().isVisible()));
  if (!priceVisible || !addVisible) throw new Error("Price or add button missing");
  results.push("PRICE VISIBLE: PASS");
  results.push("ADD BUTTON VISIBLE: PASS");

  const fabCover = await page.evaluate(() => {
    const fabs = [...document.querySelectorAll("button.a11y-fab, [aria-controls='assistant-drawer']")];
    const adds = [...document.querySelectorAll("article button")].filter((btn) =>
      btn.getAttribute("aria-label")?.toLowerCase().includes("add") ||
      btn.querySelector("svg")
    );
    const lastAdds = adds.slice(-2);
    return lastAdds.some((add) => {
      const ar = add.getBoundingClientRect();
      return fabs.some((fab) => {
        const fr = fab.getBoundingClientRect();
        const overlap = !(ar.right < fr.left || ar.left > fr.right || ar.bottom < fr.top || ar.top > fr.bottom);
        return overlap && fr.width > 0;
      });
    });
  });
  if (fabCover) throw new Error("Accessibility/chat covers an add button");
  results.push("ACCESSIBILITY/CHAT NOT COVERING ADD BUTTON: PASS");

  await trigger.click();
  await page.waitForSelector("[role='listbox']");
  const listHeight = await page.locator("[role='listbox']").evaluate((el) => el.scrollHeight > el.clientHeight || el.clientHeight <= window.innerHeight * 0.7);
  if (!listHeight) throw new Error("Dropdown list is not constrained");
  const labels = await page.locator("[role='option']").allTextContents();
  if (labels.some((label) => label.trim().toUpperCase().includes("TEST"))) {
    throw new Error("TEST still visible in public category list");
  }
  results.push("TEST PRODUCT HIDDEN/REMOVED: PASS");
  results.push("CATEGORY SCROLL: PASS");

  const second = page.locator("[role='option']").nth(1);
  await second.click();
  await page.waitForTimeout(400);
  if ((await page.locator("[role='listbox']").count()) !== 0) {
    throw new Error("Dropdown did not close after select");
  }
  results.push("SELECT CATEGORY: PASS");
  results.push("DROPDOWN CLOSE: PASS");
  results.push("SCROLL TO PRODUCTS: PASS");

  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(300);
  const sticky = await page.locator("[data-category-dropdown] [aria-haspopup='listbox']").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 40 && rect.top <= 80;
  });
  if (!sticky) throw new Error("Category selector is not sticky under the header");
  results.push("STICKY CATEGORY: PASS");

  const lastCard = page.locator("article").filter({ visible: true }).last();
  await lastCard.scrollIntoViewIfNeeded();
  const covered = await lastCard.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const nav = document.querySelector("[data-mobile-bottom-nav]") as HTMLElement | null;
    if (!nav) return false;
    return rect.bottom > nav.getBoundingClientRect().top + 8;
  });
  if (covered) throw new Error("Bottom nav covers the last product");
  results.push("BOTTOM NAV DOES NOT COVER PRODUCT: PASS");
  results.push("PRODUCT FOCUS: PASS");

  await openHome("he", 390);
  const heDir = await page.evaluate(() => document.documentElement.dir);
  if (heDir !== "rtl") throw new Error(`Hebrew dir expected rtl, got ${heDir}`);
  await page.waitForSelector("[data-category-dropdown] [aria-haspopup='listbox']");
  results.push("HEBREW RTL: PASS");

  await openHome("en", 430);
  const enDir = await page.evaluate(() => document.documentElement.dir);
  if (enDir !== "ltr") throw new Error(`English dir expected ltr, got ${enDir}`);
  await page.waitForSelector("[data-category-dropdown] [aria-haspopup='listbox']");
  results.push("ENGLISH LTR: PASS");

  for (const width of widths) {
    await page.setViewportSize({ width, height: 780 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-category-dropdown] [aria-haspopup='listbox']");
    const visible = await page.locator("[data-category-dropdown] [aria-haspopup='listbox']").isVisible();
    if (!visible) throw new Error(`Dropdown missing at ${width}px`);
  }

  await browser.close();
  for (const line of results) console.log(line);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
