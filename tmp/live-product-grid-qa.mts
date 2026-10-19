import { existsSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright-core";

const BASE = "https://mishkatcafe.dev";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const OUT = "tmp/product-grid-qa";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function openMenu(page: Page, locale: "ar" | "he" | "en") {
  await page.addInitScript((lang) => localStorage.setItem("mishkat-locale", lang), locale);
  await page.goto(`${BASE}/?gridqa=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(4500);
  await page.locator("#menu").scrollIntoViewIfNeeded().catch(() => undefined);
  const articles = page.locator("#menu article");
  if ((await articles.count()) === 0) {
    const pills = page.locator("button.rounded-full");
    const n = await pills.count();
    for (let i = 0; i < Math.min(n, 16); i++) {
      await pills.nth(i).click({ timeout: 800 }).catch(() => undefined);
      await sleep(600);
      if ((await articles.count()) > 0) break;
    }
  }
  await articles.first().waitFor({ timeout: 25000 });
  await articles.first().scrollIntoViewIfNeeded();
  await sleep(300);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("#menu article"));
    const visible = cards
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), w: r.width, h: r.height };
      })
      .filter((r) => r.w > 80 && r.h > 80)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const firstTop = visible[0]?.top ?? 0;
    const firstRow = visible.filter((c) => Math.abs(c.top - firstTop) < 48);
    const img = cards[0]?.querySelector("img");
    const imgBox = img?.getBoundingClientRect();
    const cardBox = cards[0]?.getBoundingClientRect();
    const title = cards[0]?.querySelector("h3");
    const close = document.querySelector('[role="dialog"] button[aria-label]');
    const listLayout = Boolean(
      imgBox && cardBox && imgBox.width < cardBox.width * 0.45 && imgBox.height < 160
    );
    return {
      cardCount: cards.length,
      cols: firstRow.length,
      imageW: imgBox ? Math.round(imgBox.width) : 0,
      imageH: imgBox ? Math.round(imgBox.height) : 0,
      imageRatio: imgBox && imgBox.height > 0 ? Number((imgBox.width / imgBox.height).toFixed(2)) : 0,
      cardW: Math.round(cardBox?.width ?? 0),
      title: title?.textContent?.trim().slice(0, 40) ?? "",
      titleDir: title?.getAttribute("dir") || "",
      listLayout,
      htmlDir: document.documentElement.getAttribute("dir") || "",
      hasClose: Boolean(close),
    };
  });
}

async function clickCategory(page: Page, label: string) {
  const pill = page.locator("button").filter({ hasText: label }).first();
  if ((await pill.count()) === 0) return false;
  await pill.click({ timeout: 3000 }).catch(() => undefined);
  await sleep(900);
  return (await page.locator("#menu article").count()) > 0;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openMenu(desktop, "ar");
    const d = await measure(desktop);
    record("DESKTOP 2-COLUMN", d.cols === 2, JSON.stringify({ cols: d.cols, cardW: d.cardW }));
    record("LARGE PRODUCT IMAGES", d.imageW >= 360 && !d.listLayout, `w=${d.imageW} h=${d.imageH}`);
    record("IMAGE ASPECT", d.imageRatio >= 1.2 && d.imageRatio <= 1.5, `ratio=${d.imageRatio}`);
    record("ARABIC RTL", d.htmlDir === "rtl" || d.titleDir === "rtl", `dir=${d.htmlDir}/${d.titleDir}`);
    await desktop.screenshot({ path: `${OUT}/desktop-ar.png` });

    await desktop.locator("#menu article").first().click();
    await sleep(1200);
    const dialog = desktop.locator('[role="dialog"]');
    const dialogOpen = (await dialog.count()) > 0 && (await dialog.first().isVisible());
    record("PRODUCT MODAL", dialogOpen);
    const x = dialog.locator("button").filter({ has: desktop.locator("svg") }).first();
    const xVisible = dialogOpen && (await x.isVisible().catch(() => false));
    record("X CLOSE", Boolean(xVisible));
    if (xVisible) {
      await x.click();
      await sleep(500);
    }
    await desktop.screenshot({ path: `${OUT}/desktop-modal.png` });

    const cats = ["مشروبات ساخنة", "فطور", "ساندويشات", "أطباقنا", "سلطاتنا", "مخبوزات وحلويات"];
    let categoryFails = 0;
    for (const cat of cats) {
      const ok = await clickCategory(desktop, cat);
      const m = ok ? await measure(desktop) : { cols: 0, listLayout: true, cardCount: 0 };
      const pass = ok && m.cardCount > 0 && m.cols <= 2 && !m.listLayout;
      record(`CATEGORY ${cat}`, pass, `cards=${m.cardCount} cols=${m.cols}`);
      if (!pass) categoryFails += 1;
    }
    record("OTHER CATEGORIES", categoryFails === 0, `fails=${categoryFails}`);
    await desktop.close();

    const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await openMenu(tablet, "ar");
    const t = await measure(tablet);
    record("TABLET 2-COLUMN", t.cols === 2, JSON.stringify({ cols: t.cols, imageW: t.imageW }));
    record("TABLET LARGE IMAGE", t.imageW >= 280 && !t.listLayout, `w=${t.imageW}`);
    await tablet.screenshot({ path: `${OUT}/tablet-ar.png` });
    await tablet.close();

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    await openMenu(mobile, "ar");
    const m = await measure(mobile);
    record("MOBILE 1-COLUMN", m.cols === 1, JSON.stringify({ cols: m.cols, imageW: m.imageW, cardW: m.cardW }));
    record("MOBILE LARGE IMAGE", m.imageW >= 300 && !m.listLayout, `w=${m.imageW} card=${m.cardW}`);
    await mobile.screenshot({ path: `${OUT}/mobile-ar.png` });
    await mobile.close();

    const he = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await openMenu(he, "he");
    const hm = await measure(he);
    record("HEBREW RTL", hm.htmlDir === "rtl" || hm.titleDir === "rtl", `dir=${hm.htmlDir}`);
    record("HEBREW GRID", hm.cols === 2 && !hm.listLayout, `cols=${hm.cols}`);
    await he.screenshot({ path: `${OUT}/desktop-he.png` });
    await he.close();

    const en = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await openMenu(en, "en");
    const em = await measure(en);
    record("ENGLISH", em.htmlDir === "ltr" || em.titleDir === "ltr" || em.cols === 2, `dir=${em.htmlDir} cols=${em.cols}`);
    record("ENGLISH GRID", em.cols === 2 && !em.listLayout, `cols=${em.cols}`);
    await en.screenshot({ path: `${OUT}/desktop-en.png` });
    await en.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
