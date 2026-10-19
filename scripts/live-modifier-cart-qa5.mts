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
    localStorage.setItem(
      "mishkat-cart-v2",
      JSON.stringify({ items: [], couponCode: "", couponDiscount: 0 })
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.goto("http://localhost:3002/#menu", { waitUntil: "domcontentloaded" });
  await sleep(3500);
  await page.getByRole("button", { name: /שתייה חמה/ }).first().click();
  await sleep(1500);

  // Open הפוך via card title
  await page.locator("article").filter({ hasText: "הפוך" }).first().locator("h3").click();
  await sleep(2000);

  // Start add -> opens wizard
  await page.locator('[role="dialog"]').getByRole("button", { name: /הוסף לעגלה/ }).click();
  await sleep(1500);

  // In wizard: click required options then continue until done
  for (let step = 0; step < 8; step++) {
    const dialog = page.locator('[role="dialog"]').last();
    const text = await dialog.innerText().catch(() => "");
    console.log("STEP", step, text.slice(0, 180).replace(/\n/g, " | "));

    // pick first selectable option row/button that looks like a choice
    const option = dialog.getByRole("button").filter({ hasText: /קטן|גדול|רגיל|סויה|1%|זכוכית|חד פעמית|צבעונית/ });
    if (await option.count()) {
      await option.first().click();
      await sleep(400);
    } else {
      // radio-like buttons
      const all = dialog.locator("button");
      const n = await all.count();
      for (let i = 0; i < n; i++) {
        const t = (await all.nth(i).innerText()).trim();
        if (!t || t.length > 25) continue;
        if (/המשך|חזרה|הוס|סגור|כמות|−|\+|השלם/i.test(t)) continue;
        await all.nth(i).click().catch(() => undefined);
        await sleep(200);
        break;
      }
    }

    const continueBtn = dialog.getByRole("button", { name: /המשך|הוסף|סיום|לסל/ });
    if (await continueBtn.count()) {
      const btn = continueBtn.first();
      const disabled = await btn.isDisabled().catch(() => true);
      console.log("CONTINUE", await btn.innerText(), "disabled", disabled);
      if (!disabled) {
        await btn.click();
        await sleep(1000);
      } else {
        // try select again
        await sleep(300);
      }
    }

    const cart = await page.evaluate(() => localStorage.getItem("mishkat-cart-v2"));
    if (cart && cart.includes('"productId"')) {
      console.log("CART_OK", cart.slice(0, 1200));
      break;
    }
  }

  const finalCart = await page.evaluate(() => localStorage.getItem("mishkat-cart-v2"));
  console.log("FINAL_CART", finalCart);

  await page.goto("http://localhost:3002/cart", { waitUntil: "domcontentloaded" });
  await sleep(2000);
  console.log("CART_PAGE", (await page.locator("body").innerText()).slice(0, 700));

  await page.goto("http://localhost:3002/checkout", { waitUntil: "domcontentloaded" });
  await sleep(2000);
  console.log("CHECKOUT_PAGE", (await page.locator("body").innerText()).slice(0, 700));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
