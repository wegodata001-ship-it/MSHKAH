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
  await page.evaluate(() => localStorage.setItem("mishkat-locale", "he"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4500);
  await page.goto("http://localhost:3002/#menu", { waitUntil: "domcontentloaded" });
  await sleep(4000);

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 50)
  );
  console.log("BUTTONS", JSON.stringify(buttons, null, 2));
  console.log(
    "ARTICLES",
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("article h3")).map((h) => h.textContent)
    )
  );

  // click any button containing salad-like text
  for (const label of buttons) {
    if (/סלט|salad|سلطة/i.test(label)) {
      await page.getByRole("button", { name: label }).first().click().catch(async () => {
        await page.locator("button", { hasText: label }).first().click();
      });
      console.log("CLICKED", label);
      await sleep(2000);
      break;
    }
  }
  console.log(
    "AFTER",
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("article h3")).map((h) => h.textContent)
    )
  );

  // open first product with preview
  const pos = await page.evaluate(() => {
    const art = Array.from(document.querySelectorAll("article")).find((a) =>
      a.querySelector(".pointer-events-none.select-none")
    );
    if (!art) return null;
    const r = art.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 24, name: art.querySelector("h3")?.textContent };
  });
  console.log("OPEN", pos);
  if (pos) {
    await page.mouse.click(pos.x, pos.y);
    await sleep(2000);
    const info = await page.evaluate(() => {
      const d =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-state='open']");
      if (!d) return null;
      return {
        text: (d.textContent || "").replace(/\s+/g, " ").slice(0, 350),
        buttons: Array.from(d.querySelectorAll("button")).map((b) => ({
          t: (b.textContent || "").trim().slice(0, 50),
          disabled: (b as HTMLButtonElement).disabled,
        })),
      };
    });
    console.log("DIALOG", JSON.stringify(info, null, 2));

    await page.evaluate(() => {
      const d =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-state='open']");
      if (!d) return;
      for (const b of Array.from(d.querySelectorAll("button"))) {
        const t = (b.textContent || "").trim();
        if (/קטן|גדול|רגיל|סויה|1%|חזה|עוף|וניל|קינדר/i.test(t)) {
          (b as HTMLButtonElement).click();
        }
      }
    });
    await sleep(700);
    const add = await page.evaluate(() => {
      const d =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-state='open']");
      const btn = Array.from(d?.querySelectorAll("button") || []).find((b) =>
        /הוס|לסל|Add/i.test(b.textContent || "")
      ) as HTMLButtonElement | undefined;
      const before = btn?.disabled;
      btn?.click();
      return { found: !!btn, disabledBefore: before, text: btn?.textContent?.trim() };
    });
    console.log("ADD", add);
    await sleep(1500);
  }

  console.log(
    "CART",
    await page.evaluate(() => localStorage.getItem("mishkat-cart-v2"))
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
