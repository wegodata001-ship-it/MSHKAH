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
    args: ["--window-size=420,900"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(15000);

  await page.goto("http://localhost:3002", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("mishkat-locale", "he");
    localStorage.setItem(
      "mishkat-cart-v2",
      JSON.stringify({ items: [], couponCode: "", couponDiscount: 0 })
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4500);
  await page.goto("http://localhost:3002/#menu", { waitUntil: "domcontentloaded" });
  await sleep(4000);

  await page.getByRole("button", { name: /שתייה חמה/ }).first().click();
  await sleep(2000);

  // click product title of Macchiato / הפוך (has paid size)
  const card = page.locator("article").filter({ hasText: "הפוך" }).first();
  const count = await page.locator("article").count();
  console.log("ARTICLES", count);
  console.log(
    "NAMES",
    await page.locator("article h3").allTextContents()
  );

  if ((await card.count()) === 0) {
    // fallback first with preview
    await page.locator("article").filter({ has: page.locator(".pointer-events-none") }).first().locator("h3").click();
  } else {
    await card.locator("h3").click();
  }
  await sleep(2500);

  const roleDialog = await page.locator('[role="dialog"]').count();
  console.log("ROLE_DIALOG", roleDialog);
  if (roleDialog) {
    console.log("DIALOG_TEXT", (await page.locator('[role="dialog"]').innerText()).slice(0, 400));
  }

  // screenshot
  await page.screenshot({ path: "tmp/modifier-preview-qa/cart-open.png", fullPage: true });

  // click add in dialog
  const addInDialog = page.locator('[role="dialog"]').getByRole("button", { name: /הוס|לסל|Add/i });
  if (await addInDialog.count()) {
    console.log("ADD_BTN", await addInDialog.first().innerText());
    console.log("ADD_DISABLED", await addInDialog.first().isDisabled());
    await addInDialog.first().click();
    await sleep(2000);
  }

  // wizard maybe
  const wizardAdd = page.getByRole("button", { name: /הוס|לסל|Add/i });
  console.log("ANY_ADD_COUNT", await wizardAdd.count());
  if (await page.locator('[role="dialog"]').count()) {
    // select options visible
    const optionButtons = page.locator('[role="dialog"] button');
    const n = await optionButtons.count();
    for (let i = 0; i < Math.min(n, 20); i++) {
      const t = (await optionButtons.nth(i).innerText().catch(() => "")).trim();
      if (!t || t.length > 30) continue;
      if (/הוס|סגור|Close|×|כמות|−|\+/i.test(t)) continue;
      await optionButtons.nth(i).click().catch(() => undefined);
      await sleep(200);
    }
    await sleep(500);
    if (await addInDialog.count()) {
      const disabled = await addInDialog.first().isDisabled();
      console.log("ADD_AFTER_SELECT_DISABLED", disabled);
      if (!disabled) await addInDialog.first().click();
      await sleep(1500);
    }
  }

  // Also try AddonsWizard buttons outside
  const allAdds = page.getByRole("button", { name: /הוסף|לסל/ });
  for (let i = 0; i < (await allAdds.count()); i++) {
    const disabled = await allAdds.nth(i).isDisabled().catch(() => true);
    const t = await allAdds.nth(i).innerText().catch(() => "");
    console.log("ADD_CANDIDATE", t, "disabled", disabled);
    if (!disabled) {
      await allAdds.nth(i).click();
      await sleep(1500);
      break;
    }
  }

  const cart = await page.evaluate(() => localStorage.getItem("mishkat-cart-v2"));
  console.log("CART", cart);

  await page.screenshot({ path: "tmp/modifier-preview-qa/cart-after.png", fullPage: true });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
