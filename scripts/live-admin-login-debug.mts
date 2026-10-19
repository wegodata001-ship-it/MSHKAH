import { config } from "dotenv";
config({ path: ".env" });
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;

async function main() {
  console.log("hasPass", Boolean(PASSWORD), "passLen", PASSWORD?.length ?? 0);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1280,800"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://localhost:3002/admin/login", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 4000));
  const info = await page.evaluate(() => ({
    url: location.href,
    inputs: Array.from(document.querySelectorAll("input")).map((i) => ({
      type: i.type,
      name: i.name,
      id: i.id,
      placeholder: i.placeholder,
    })),
    buttons: Array.from(document.querySelectorAll("button")).map((b) =>
      (b.textContent || "").trim().slice(0, 60)
    ),
    bodySnippet: document.body.innerText.slice(0, 500),
  }));
  console.log(JSON.stringify(info, null, 2));
  if (!PASSWORD) {
    await browser.close();
    process.exit(2);
  }
  const email = await page.$('input[type="email"], input[type="text"], input');
  const pass = await page.$('input[type="password"]');
  console.log("emailEl", !!email, "passEl", !!pass);
  if (!email || !pass) {
    await browser.close();
    process.exit(3);
  }
  await email.click({ clickCount: 3 });
  await email.type(EMAIL, { delay: 5 });
  await pass.click({ clickCount: 3 });
  await pass.type(PASSWORD, { delay: 5 });
  const clicked = await page.evaluate(() => {
    const form = document.querySelector("form");
    if (form) {
      form.requestSubmit();
      return "form.submit";
    }
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) =>
      /sign|login|התחבר|כניסה|enter/i.test(b.textContent || "")
    );
    if (btn) {
      (btn as HTMLButtonElement).click();
      return "button";
    }
    return "none";
  });
  console.log("submitMode", clicked);
  await new Promise((r) => setTimeout(r, 10000));
  console.log("afterUrl", page.url());
  console.log(
    "afterText",
    await page.evaluate(() => document.body.innerText.slice(0, 600))
  );
  await page.screenshot({
    path: "C:/Users/wegod/AppData/Local/Temp/admin-qa-login.png",
    fullPage: true,
  });
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
