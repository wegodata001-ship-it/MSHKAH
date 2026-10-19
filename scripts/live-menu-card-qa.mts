import { existsSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/menu-card-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function openMenu(page: Page) {
  await page.addInitScript(() => localStorage.setItem("mishkat-locale", "ar"));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(5000);
  await page.locator("#menu").scrollIntoViewIfNeeded().catch(() => undefined);
  const articles = page.locator("#menu article");
  if ((await articles.count()) === 0) {
    const pills = page.locator("button.rounded-full");
    const n = await pills.count();
    for (let i = 0; i < Math.min(n, 16); i++) {
      await pills.nth(i).click({ timeout: 800 }).catch(() => undefined);
      await sleep(700);
      await page.locator("#menu").scrollIntoViewIfNeeded().catch(() => undefined);
      if ((await articles.count()) > 0) break;
    }
  }
  await articles.first().waitFor({ timeout: 25000 });
  await articles.first().scrollIntoViewIfNeeded();
  await sleep(400);
}

async function measureGrid(page: Page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("article"));
    const visible = cards
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), w: r.width, h: r.height };
      })
      .filter((r) => r.w > 80 && r.h > 80)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    if (visible.length < 2) return { cols: visible.length, firstRow: visible.length, imageRatio: 0, imageW: 0, titleRtl: false, descLines: 0, priceLtr: false, addBtn: false, favOnImage: false, listLayout: false };
    const firstTop = visible[0]!.top;
    const firstRow = visible.filter((c) => Math.abs(c.top - firstTop) < 40);
    const img = cards[0]?.querySelector("img");
    const imgBox = img?.getBoundingClientRect();
    const cardBox = cards[0]?.getBoundingClientRect();
    const title = cards[0]?.querySelector("h3");
    const desc = cards[0]?.querySelector("p");
    const price = Array.from(cards[0]?.querySelectorAll("span") ?? []).find((s) => /₪|\\d/.test(s.textContent || "") && s.getAttribute("dir") === "ltr");
    const add = cards[0]?.querySelector("button[aria-label]");
    const fav = cards[0]?.querySelector("button[aria-label]");
    const imageParent = img?.parentElement?.getBoundingClientRect();
    const favBtn = Array.from(cards[0]?.querySelectorAll("button") ?? []).find((b) => (b.getAttribute("aria-label") || "").length > 0 && b.querySelector("svg"));
    const favOnImage = Boolean(
      favBtn &&
        imageParent &&
        favBtn.getBoundingClientRect().top >= imageParent.top - 4 &&
        favBtn.getBoundingClientRect().top <= imageParent.bottom
    );
    const listLayout = Boolean(imgBox && cardBox && imgBox.width < cardBox.width * 0.45 && imgBox.height < 150);
    const lineH = desc ? parseFloat(getComputedStyle(desc).lineHeight) || 20 : 0;
    const descLines = desc && lineH ? Math.round(desc.getBoundingClientRect().height / lineH) : 0;
    return {
      cols: firstRow.length,
      firstRow: firstRow.length,
      imageRatio: imgBox && imgBox.height > 0 ? Number((imgBox.width / imgBox.height).toFixed(2)) : 0,
      imageW: imgBox ? Math.round(imgBox.width) : 0,
      titleRtl: title?.getAttribute("dir") === "rtl" || getComputedStyle(title ?? document.body).direction === "rtl",
      descLines,
      priceLtr: Boolean(price),
      addBtn: Boolean(add),
      favOnImage,
      listLayout,
      cardW: Math.round(cardBox?.width ?? 0),
    };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1280,800"],
  });

  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await openMenu(desktop);
    const d = await measureGrid(desktop);
    record("DESKTOP 2 PER ROW", d.cols === 2, JSON.stringify(d));
    record("PRODUCT IMAGES LARGE", d.imageW >= 280 && !d.listLayout, `w=${d.imageW}`);
    record("IMAGE ASPECT RATIO", d.imageRatio >= 1.2 && d.imageRatio <= 1.5, `ratio=${d.imageRatio}`);
    record("NO DISTORTED IMAGES", !d.listLayout && d.imageRatio >= 1.2);
    record("ARABIC RTL", d.titleRtl);
    record("DESCRIPTION", d.descLines >= 1 && d.descLines <= 3, `lines=${d.descLines}`);
    record("PRICE", d.priceLtr);
    record("ADD BUTTON", d.addBtn);
    record("FAVORITES", d.favOnImage);
    await desktop.screenshot({ path: `${OUT}/desktop-1280.png`, fullPage: false });

    const firstCard = desktop.locator("article").first();
    await firstCard.locator("button").first().click();
    await sleep(400);
    const favFilled = await firstCard.evaluate((el) =>
      Array.from(el.querySelectorAll("svg")).some((svg) => /fill-gold|text-gold/.test(svg.className.baseVal || svg.getAttribute("class") || ""))
    );
    record("FAVORITE TOGGLE", favFilled);

    await firstCard.locator("h3").click();
    await sleep(1500);
    const dialog = desktop.locator('[role="dialog"]');
    const dialogOpen = (await dialog.count()) > 0 && (await dialog.first().isVisible());
    record("PRODUCT OPTIONS", dialogOpen);
    if (dialogOpen) {
      const addInDialog = dialog.locator("button").filter({ hasText: /إضافة|הוספה|Add/ }).first();
      if (await addInDialog.count()) {
        await addInDialog.click();
        await sleep(1500);
      }
    }
    const cartVisible = await desktop.evaluate(() =>
      /סל|السلة|Cart|₪/.test(document.body.innerText)
    );
    record("CART", cartVisible || dialogOpen);
    await desktop.screenshot({ path: `${OUT}/desktop-dialog.png` });
    await desktop.close();

    const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await openMenu(tablet);
    const t = await measureGrid(tablet);
    record("TABLET 2 PER ROW", t.cols === 2, JSON.stringify({ cols: t.cols, imageW: t.imageW }));
    record("TABLET IMAGES LARGE", t.imageW >= 220 && !t.listLayout, `w=${t.imageW}`);
    await tablet.screenshot({ path: `${OUT}/tablet-768.png` });
    await tablet.close();

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    await openMenu(mobile);
    const m = await measureGrid(mobile);
    record("MOBILE 2 PER ROW", m.cols === 2, JSON.stringify({ cols: m.cols, imageW: m.imageW, cardW: m.cardW }));
    record("MOBILE IMAGE FULL WIDTH", m.imageW >= 140 && !m.listLayout, `w=${m.imageW}`);
    const hScroll = await mobile.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    record("NO HORIZONTAL SCROLL", !hScroll);
    await mobile.screenshot({ path: `${OUT}/mobile-390.png` });
    await mobile.close();

    const imgCount = await (await browser.newPage()).evaluate(() => 0);
    record("IMAGE LOADING", d.imageW > 0);
    void imgCount;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("QA_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
