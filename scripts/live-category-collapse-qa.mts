/**
 * Mobile category auto-collapse QA
 * Run: npx tsx scripts/live-category-collapse-qa.mts
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3003";
const CHROME = existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function record(name: string, pass: boolean, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

async function runAtWidth(width: number) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const outDir = join(process.cwd(), "tmp", "category-collapse-qa");
  mkdirSync(outDir, { recursive: true });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("mishkat-locale", "he"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.goto(`${BASE}/#menu`, { waitUntil: "domcontentloaded" });
  await sleep(3500);

  let passes = 0;
  let fails = 0;
  const check = (name: string, pass: boolean, detail?: string) => {
    if (record(`[${width}] ${name}`, pass, detail)) passes++;
    else fails++;
  };

  const showAll = page.getByRole("button", { name: /הצג הכל|הצג עוד|Show all/i });
  check("show-all button visible", (await showAll.count()) > 0);

  const pillsBefore = await page.locator('nav[aria-label="Categories"] button').count();
  await showAll.first().click();
  await sleep(700);
  const pillsExpanded = await page.locator('nav[aria-label="Categories"] button').count();
  check("TEST1 expanded shows more categories", pillsExpanded > pillsBefore, `${pillsBefore} → ${pillsExpanded}`);

  // Pick a late category (prefer ice drinks / beyond first row)
  const late = page.locator('nav[aria-label="Categories"] button').nth(Math.min(pillsExpanded - 1, 9));
  const lateLabel = ((await late.innerText()) || "").replace(/\s+/g, " ").trim();
  await late.click();
  await sleep(1200);

  const pillsAfter = await page.locator('nav[aria-label="Categories"] button').count();
  const showAllAgain = await page.getByRole("button", { name: /הצג הכל|Show all/i }).count();
  const showLess = await page.getByRole("button", { name: /הצג פחות|Show less/i }).count();
  check("TEST3 auto collapsed", pillsAfter < pillsExpanded && showAllAgain > 0 && showLess === 0, `pills ${pillsExpanded} → ${pillsAfter}`);

  const selected = page.locator('nav[aria-label="Categories"] button').filter({ has: page.locator(".bg-turquoise, .text-white") });
  // selected pill has turquoise bg
  const selectedCount = await page.locator('nav[aria-label="Categories"] button.bg-turquoise').count().catch(async () => {
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll('nav[aria-label="Categories"] button')).filter((b) =>
        b.className.includes("bg-turquoise")
      ).length;
    });
  });
  check("TEST2/6 selected category still visible & active", selectedCount > 0, lateLabel);

  const menuTop = await page.evaluate(() => {
    const el = document.getElementById("menu");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, title: el.querySelector("h2")?.textContent?.trim() || "" };
  });
  check("TEST4/5 products section in view below sticky chrome", !!menuTop && menuTop.top >= 40 && menuTop.top < 320, JSON.stringify(menuTop));

  await page.getByRole("button", { name: /הצג הכל|Show all/i }).first().click();
  await sleep(600);
  const reexpanded = await page.locator('nav[aria-label="Categories"] button').count();
  check("TEST7 show-all works again", reexpanded >= pillsExpanded, `${reexpanded}`);

  await page.screenshot({ path: join(outDir, `w-${width}.png`) });
  await browser.close();
  return { width, passes, fails };
}

async function main() {
  const widths = [320, 360, 375, 390, 430];
  let totalPass = 0;
  let totalFail = 0;
  for (const w of widths) {
    const r = await runAtWidth(w);
    totalPass += r.passes;
    totalFail += r.fails;
  }
  console.log(`\nTOTAL PASS ${totalPass} / FAIL ${totalFail}`);
  if (totalFail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
