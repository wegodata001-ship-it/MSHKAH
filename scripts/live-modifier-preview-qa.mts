/**
 * LIVE Modifier Preview QA (customer menu)
 * Run: npx tsx scripts/live-modifier-preview-qa.mts
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { chromium, type Page } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3002";
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function setLocale(page: Page, locale: "he" | "ar" | "en") {
  await page.evaluate((loc) => {
    localStorage.setItem("mishkat-locale", loc);
  }, locale);
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(3500);
}

async function waitForMenu(page: Page) {
  await page.goto(`${BASE}/#menu`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(4500);
  const hasArticles = await page.locator("article").count();
  if (hasArticles === 0) {
    const buttons = page.locator("button");
    const n = await buttons.count();
    for (let i = 0; i < Math.min(n, 14); i++) {
      await buttons.nth(i).click({ timeout: 1000 }).catch(() => undefined);
      await sleep(700);
      if ((await page.locator("article").count()) > 0) break;
    }
  }
  await sleep(1500);
}

type CardProbe = {
  count: boolean;
  hasPreview: boolean;
  previewTexts: string[];
  hasPlusZero: boolean;
  hasPaid: boolean;
  hasTruncation: boolean;
  hebrewLeak: boolean;
  arabicHint: boolean;
  englishHint: boolean;
  overflowX: boolean;
  maxPreviewFontPx: number;
  minPreviewFontPx: number;
  tallestCardPx: number;
  previewPointerEvents: string | null;
  cardsWithoutPreview: number;
  cardsWithPreview: number;
  hasChooseOne: boolean;
  hasChooseExact: boolean;
  hasChooseUpTo: boolean;
};

async function probeCards(page: Page, locale: string): Promise<CardProbe> {
  return page.evaluate((loc) => {
    const articles = Array.from(document.querySelectorAll("article"));
    const previewTexts: string[] = [];
    let hasPreview = false;
    let hasPlusZero = false;
    let hasPaid = false;
    let hasTruncation = false;
    let hebrewLeak = false;
    let arabicHint = false;
    let englishHint = false;
    let overflowX = false;
    let maxPreviewFontPx = 0;
    let minPreviewFontPx = 99;
    let tallestCardPx = 0;
    let previewPointerEvents: string | null = null;
    let cardsWithPreview = 0;
    let cardsWithoutPreview = 0;
    let hasChooseOne = false;
    let hasChooseExact = false;
    let hasChooseUpTo = false;

    const heRe = /בחיר|אפשרויות/;
    const arRe = /اختيار|خيارات/;
    const enRe = /Choose |Up to |\+?\d+\s*options/i;

    for (const article of articles) {
      tallestCardPx = Math.max(tallestCardPx, article.getBoundingClientRect().height);
      if (article.scrollWidth > article.clientWidth + 1) overflowX = true;

      const previewRoots = Array.from(article.querySelectorAll(".pointer-events-none.select-none"));
      if (previewRoots.length === 0) {
        cardsWithoutPreview++;
        continue;
      }
      cardsWithPreview++;

      for (const root of previewRoots) {
        hasPreview = true;
        const text = (root.textContent || "").replace(/\s+/g, " ").trim();
        if (text) previewTexts.push(text);
        previewPointerEvents = getComputedStyle(root).pointerEvents;

        if (/\+0(\.00)?\s*₪|\+₪\s*0(\.00)?/.test(text) || /\+0\.00/.test(text)) hasPlusZero = true;
        if (/\+\d/.test(text)) hasPaid = true;
        if (/\+\d+\s*(خيارات|אפשרויות|options)/i.test(text)) hasTruncation = true;

        if (/בחירה אחת|اختيار واحد|Choose one/i.test(text)) hasChooseOne = true;
        if (/בחירת \d+|اختيار \d+|Choose \d+/i.test(text)) hasChooseExact = true;
        if (/בחירה עד|اختيار حتى|Up to \d+/i.test(text)) hasChooseUpTo = true;

        if (loc === "ar" && heRe.test(text)) hebrewLeak = true;
        if (loc === "en" && heRe.test(text)) hebrewLeak = true;
        if (arRe.test(text)) arabicHint = true;
        if (enRe.test(text)) englishHint = true;

        for (const el of Array.from(root.querySelectorAll("*"))) {
          const fs = parseFloat(getComputedStyle(el).fontSize || "0");
          if (fs > 0) {
            maxPreviewFontPx = Math.max(maxPreviewFontPx, fs);
            minPreviewFontPx = Math.min(minPreviewFontPx, fs);
          }
        }
      }
    }

    return {
      count: articles.length > 0,
      hasPreview,
      previewTexts: previewTexts.slice(0, 12),
      hasPlusZero,
      hasPaid,
      hasTruncation,
      hebrewLeak,
      arabicHint,
      englishHint,
      overflowX,
      maxPreviewFontPx,
      minPreviewFontPx: minPreviewFontPx === 99 ? 0 : minPreviewFontPx,
      tallestCardPx,
      previewPointerEvents,
      cardsWithoutPreview,
      cardsWithPreview,
      hasChooseOne,
      hasChooseExact,
      hasChooseUpTo,
    };
  }, locale);
}

async function clickPreviewOpensProduct(page: Page): Promise<{ opened: boolean; detail: string }> {
  const clicked = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll("article"));
    for (const article of articles) {
      const root = article.querySelector(".pointer-events-none.select-none") as HTMLElement | null;
      if (!root) continue;
      const r = root.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      return {
        x: r.left + Math.min(24, r.width / 2),
        y: r.top + Math.min(10, r.height / 2),
      };
    }
    return null;
  });

  if (!clicked) return { opened: false, detail: "no preview area found to click" };

  await page.mouse.click(clicked.x, clicked.y);
  await sleep(1200);

  const opened = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) return true;
    const drawers = Array.from(document.querySelectorAll("[data-state='open']"));
    return drawers.some((el) => (el.textContent || "").length > 40);
  });

  await page.keyboard.press("Escape");
  await sleep(500);

  return { opened, detail: `click at ${Math.round(clicked.x)},${Math.round(clicked.y)}` };
}

async function cartRegression(page: Page): Promise<{ pass: boolean; detail: string }> {
  const target = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll("article"));
    for (const article of articles) {
      if (!article.querySelector(".pointer-events-none.select-none")) continue;
      const r = article.getBoundingClientRect();
      if (r.height < 20) continue;
      return { x: r.left + r.width / 2, y: r.top + 24 };
    }
    const a = articles[0]?.getBoundingClientRect();
    if (!a) return null;
    return { x: a.left + a.width / 2, y: a.top + 24 };
  });
  if (!target) return { pass: false, detail: "no product card" };

  await page.mouse.click(target.x, target.y);
  await sleep(1500);

  await page.evaluate(() => {
    const dialog =
      document.querySelector('[role="dialog"]') ||
      document.querySelector("[data-state='open']");
    if (!dialog) return;
    const buttons = Array.from(dialog.querySelectorAll("button"));
    let clicked = 0;
    for (const b of buttons) {
      const t = (b.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (/close|סגור|إغلاق|×/i.test(t)) continue;
      if (/add|הוס|أضف|cart|סל|سلة/i.test(t)) continue;
      (b as HTMLButtonElement).click();
      clicked++;
      if (clicked >= 4) break;
    }
  });
  await sleep(700);

  const addResult = await page.evaluate(() => {
    const dialog =
      document.querySelector('[role="dialog"]') ||
      document.querySelector("[data-state='open']");
    if (!dialog) return { clicked: false, reason: "no dialog" };
    const buttons = Array.from(dialog.querySelectorAll("button"));
    const addBtn = buttons.find((b) =>
      /add|הוס|أضف|cart|סל|سلة|לסל/i.test((b.textContent || "").trim())
    ) as HTMLButtonElement | undefined;
    if (!addBtn) return { clicked: false, reason: "no add button" };
    if (addBtn.disabled) return { clicked: false, reason: "add disabled (validation blocking)" };
    addBtn.click();
    return { clicked: true, reason: "clicked add" };
  });

  await sleep(1200);

  const cartInfo = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const cartKey = keys.find((k) => /cart/i.test(k));
    let raw = cartKey ? localStorage.getItem(cartKey) : null;
    if (!raw) {
      for (const k of ["mishkat-cart", "cart", "mishkah-cart"]) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
    }
    return { cartKey: cartKey ?? null, raw: raw?.slice(0, 900) ?? null };
  });

  await page.keyboard.press("Escape");
  await sleep(400);

  const pass = addResult.clicked || Boolean(cartInfo.raw && /product|items|modifiers/i.test(cartInfo.raw));
  return {
    pass,
    detail: `${addResult.reason}; cartKey=${cartInfo.cartKey ?? "none"}; hasData=${Boolean(cartInfo.raw)}`,
  };
}

async function viewportCheck(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await sleep(900);
  const probe = await probeCards(page, "ar");
  const overflow = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    const articles = Array.from(document.querySelectorAll("article"));
    const cardOverflow = articles.some((a) => a.scrollWidth > a.clientWidth + 1);
    return {
      docOverflow,
      cardOverflow,
      cards: articles.length,
      tallest: Math.max(0, ...articles.map((a) => a.getBoundingClientRect().height)),
    };
  });
  return { probe, overflow };
}

async function main() {
  const outDir = join(process.cwd(), "tmp", "modifier-preview-qa");
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--window-size=1280,900"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    // default QA locale; overridden by setLocale
    if (!localStorage.getItem("mishkat-locale")) {
      localStorage.setItem("mishkat-locale", "ar");
    }
  });

  const listenUrls: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("firestore.googleapis.com") || u.includes("Listen") || u.includes("google.firestore")) {
      listenUrls.push(u);
    }
  });

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("mishkat-locale", "ar"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4500);
    await waitForMenu(page);
    await page.screenshot({ path: join(outDir, "desktop-ar.png") });

    const ar = await probeCards(page, "ar");
    const cardCount = await page.locator("article").count();
    record("Desktop menu loaded", ar.count, `${cardCount} cards`);
    record(
      "Has modifier preview on some cards",
      ar.hasPreview,
      `with=${ar.cardsWithPreview} without=${ar.cardsWithoutPreview} sample=${ar.previewTexts[0]?.slice(0, 120) ?? "none"}`
    );
    record("No-modifiers cards exist (empty preview area omitted)", ar.cardsWithoutPreview > 0 || !ar.hasPreview, `without=${ar.cardsWithoutPreview}`);
    record("No +0.00 ₪ on free options", !ar.hasPlusZero);
    record(
      "Paid modifier uses existing formatPrice",
      !ar.hasPaid || ar.previewTexts.some((t) => /\+\d+\.\d{2}\s*₪/.test(t)),
      ar.previewTexts.find((t) => /\+/.test(t))?.slice(0, 100) ?? "no paid sample"
    );
    record("Arabic: no Hebrew UI hint leak", !ar.hebrewLeak, ar.previewTexts.find((t) => /בחיר|אפשרויות/.test(t)));
    record("Required/choose-one hint seen", ar.hasChooseOne || ar.hasChooseExact || ar.hasChooseUpTo, `one=${ar.hasChooseOne} exact=${ar.hasChooseExact} upTo=${ar.hasChooseUpTo}`);
    record("pointer-events-none on preview", ar.previewPointerEvents === "none", String(ar.previewPointerEvents));
    record("Desktop no horizontal overflow", !ar.overflowX);
    record("Preview font size readable band", ar.minPreviewFontPx >= 10 && ar.minPreviewFontPx <= 12, `min=${ar.minPreviewFontPx}px max=${ar.maxPreviewFontPx}px`);

    const clickOpen = await clickPreviewOpensProduct(page);
    record("Click on preview opens product", clickOpen.opened, clickOpen.detail);

    const before = listenUrls.length;
    await sleep(1500);
    await page.evaluate(() => window.scrollBy(0, 1400));
    await sleep(2500);
    const afterScroll = listenUrls.length;
    record(
      "No N+1 spike on scroll",
      afterScroll - before < 50,
      `listenRequests delta=${afterScroll - before} total=${afterScroll}`
    );

    for (const w of [320, 360, 375, 390, 430]) {
      const { overflow, probe } = await viewportCheck(page, w);
      await page.screenshot({ path: join(outDir, `mobile-${w}.png`) });
      const pass =
        overflow.cards > 0 &&
        !overflow.docOverflow &&
        !overflow.cardOverflow &&
        overflow.tallest < 480;
      record(
        `${w}px visual`,
        pass,
        `cards=${overflow.cards} tallest=${Math.round(overflow.tallest)} overflowDoc=${overflow.docOverflow} overflowCard=${overflow.cardOverflow} preview=${probe.hasPreview}`
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await setLocale(page, "he");
    await waitForMenu(page);
    const he = await probeCards(page, "he");
    await page.screenshot({ path: join(outDir, "mobile-he-390.png") });
    record("Hebrew locale preview", he.count, he.previewTexts[0]?.slice(0, 100) ?? "no preview text");
    record("Hebrew RTL dir", (await page.evaluate(() => document.documentElement.dir)) === "rtl");

    await setLocale(page, "en");
    await waitForMenu(page);
    const en = await probeCards(page, "en");
    await page.screenshot({ path: join(outDir, "mobile-en-390.png") });
    record("English locale preview", en.count, en.previewTexts[0]?.slice(0, 100) ?? "no preview text");
    record("English: no Hebrew UI leak", !en.hebrewLeak, en.previewTexts.find((t) => /בחיר|אפשרויות/.test(t)));
    record("English LTR dir", (await page.evaluate(() => document.documentElement.dir)) === "ltr");
    record(
      "Truncation (+N options) observed",
      ar.hasTruncation || he.hasTruncation || en.hasTruncation,
      "FAIL only if catalog has no group with >3 options"
    );

    const cart = await cartRegression(page);
    record("Cart add flow (modifier product)", cart.pass, cart.detail);

    await page.goto(`${BASE}/cart`, { waitUntil: "domcontentloaded" });
    await sleep(2000);
    record("Cart page loads", (await page.locator("body").innerText()).length > 20);

    await page.goto(`${BASE}/checkout`, { waitUntil: "domcontentloaded" });
    await sleep(2000);
    const checkoutText = await page.locator("body").innerText();
    record("Checkout page loads", checkoutText.length > 20 && !/Application error/i.test(checkoutText));
  } finally {
    const report = {
      base: BASE,
      checks,
      passCount: checks.filter((c) => c.pass).length,
      failCount: checks.filter((c) => !c.pass).length,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log("\n--- SUMMARY ---");
    console.log(`PASS ${report.passCount} / FAIL ${report.failCount}`);
    console.log(`Artifacts: ${outDir}`);
    await browser.close();
    if (report.failCount > 0) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
