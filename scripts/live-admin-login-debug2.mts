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
  page.on("console", (m) => console.log("C", m.text()));
  await page.goto("http://localhost:3002/admin/login", {
    waitUntil: "domcontentloaded",
  });
  await new Promise((r) => setTimeout(r, 2500));

  await page.focus("#email");
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(EMAIL, { delay: 20 });

  await page.focus("#password");
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(PASSWORD, { delay: 20 });

  const vals = await page.evaluate(() => ({
    email: (document.querySelector("#email") as HTMLInputElement).value,
    passLen: (document.querySelector("#password") as HTMLInputElement).value
      .length,
  }));
  console.log("filled", { email: vals.email, passLen: vals.passLen });

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("התחברות")
    ) as HTMLButtonElement | undefined;
    if (!btn) throw new Error("no login button");
    btn.click();
  });
  console.log("clicked login");

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const url = page.url();
    const err = await page.evaluate(() => {
      const t = document.body.innerText;
      if (/error|שגיא|invalid|wrong|failed|Incorrect|לא תקין|User profile/i.test(t)) {
        return t.slice(0, 800);
      }
      return null;
    });
    console.log("tick", i, url, err ? `ERR_SNIP:${err.slice(0, 160)}` : "ok");
    if (!url.includes("/login")) {
      console.log("LOGIN_OK", url);
      await browser.close();
      return;
    }
  }
  console.log("LOGIN_FAIL");
  await page.screenshot({
    path: "C:/Users/wegod/AppData/Local/Temp/admin-qa-login-fail.png",
    fullPage: true,
  });
  await browser.close();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
