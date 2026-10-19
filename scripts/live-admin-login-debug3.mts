import { config } from "dotenv";
config({ path: ".env" });
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD!;

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:3002/admin/login", {
    waitUntil: "domcontentloaded",
  });
  await new Promise((r) => setTimeout(r, 2500));

  await page.$eval(
    "#email",
    (el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      const tracker = (input as unknown as { _valueTracker?: { setValue: (v: string) => void } })
        ._valueTracker;
      const last = input.value;
      setter?.call(input, value);
      tracker?.setValue(last);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    EMAIL
  );

  await page.$eval(
    "#password",
    (el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      const tracker = (input as unknown as { _valueTracker?: { setValue: (v: string) => void } })
        ._valueTracker;
      const last = input.value;
      setter?.call(input, value);
      tracker?.setValue(last);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    PASSWORD
  );

  await page.$$eval("button", (buttons) => {
    const btn = buttons.find((b) => (b.textContent || "").includes("התחברות")) as
      | HTMLButtonElement
      | undefined;
    if (!btn) throw new Error("no login button");
    btn.click();
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const url = page.url();
    const text = await page.evaluate(() => document.body.innerText.slice(0, 700));
    if (!url.includes("/login")) {
      console.log("LOGIN_OK", url);
      await browser.close();
      return;
    }
    if (i % 4 === 0) console.log("tick", i, text.slice(0, 200).replace(/\n/g, " | "));
  }
  console.log("LOGIN_FAIL last=", page.url());
  await browser.close();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
