import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { chromium } from "playwright-core";
import { existsSync } from "fs";

const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3002";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("mishkat-locale", "ar"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.goto(`${BASE}/#menu`, { waitUntil: "domcontentloaded" });
  await sleep(4000);

  const cats = page.locator("button");
  const n = await cats.count();
  const samples: { cat: string; name: string; preview: string }[] = [];

  for (let i = 0; i < Math.min(n, 30); i++) {
    const label = ((await cats.nth(i).innerText().catch(() => "")) || "").trim();
    if (!label || label.length > 28) continue;
    await cats.nth(i).click({ timeout: 1000 }).catch(() => undefined);
    await sleep(800);
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll("article"))
        .map((a) => ({
          name: a.querySelector("h3")?.textContent?.trim() || "",
          preview:
            a
              .querySelector(".pointer-events-none.select-none")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() || "",
        }))
        .filter((x) => x.preview)
    );
    for (const f of found) samples.push({ cat: label, ...f });
  }

  const unique: typeof samples = [];
  const seen = new Set<string>();
  for (const s of samples) {
    const k = `${s.name}|${s.preview}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(s);
  }

  console.log("PREVIEW_COUNT", unique.length);
  for (const s of unique) {
    console.log("---");
    console.log("CAT", s.cat);
    console.log("NAME", s.name);
    console.log("PREV", s.preview);
  }

  const paid = unique.filter((s) => /\+\d+\.\d{2}\s*₪/.test(s.preview));
  console.log("PAID_SAMPLES", paid.length);
  for (const s of paid.slice(0, 8)) console.log("PAID", s.name, "=>", s.preview);

  // Cart payload after opening a modifier product
  await page.evaluate(() => localStorage.setItem("mishkat-locale", "he"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(3500);
  await page.goto(`${BASE}/#menu`, { waitUntil: "domcontentloaded" });
  await sleep(3500);

  const target = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) =>
      a.querySelector(".pointer-events-none.select-none")
    );
    if (!art) return null;
    const r = art.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 28 };
  });

  if (target) {
    await page.mouse.click(target.x, target.y);
    await sleep(1600);
    await page.evaluate(() => {
      const d =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-state='open']");
      if (!d) return;
      for (const b of Array.from(d.querySelectorAll("button")).slice(0, 16)) {
        const t = (b.textContent || "").trim();
        if (!t || t.length > 28) continue;
        if (/הוס|Add|أضف|לסל|cart|סגור|Close/i.test(t)) continue;
        (b as HTMLButtonElement).click();
      }
    });
    await sleep(600);
    await page.evaluate(() => {
      const d =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-state='open']");
      const add = Array.from(d?.querySelectorAll("button") || []).find((b) =>
        /הוס|Add|أضف|לסל/i.test(b.textContent || "")
      ) as HTMLButtonElement | undefined;
      add?.click();
    });
    await sleep(1200);
  }

  const cart = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("mishkat-cart-v2") || "null");
    } catch {
      return localStorage.getItem("mishkat-cart-v2");
    }
  });
  console.log("CART_JSON", JSON.stringify(cart, null, 2)?.slice(0, 3000));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
