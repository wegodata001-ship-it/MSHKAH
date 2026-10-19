import { existsSync } from "fs";
import { chromium } from "playwright-core";

const CHROME = existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem("mishkat-locale", "ar"));
  await page.goto("https://mishkatcafe.dev/?imgqa=1", { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(6000);
  await page.locator("#menu article img").first().waitFor({ timeout: 20000 }).catch(() => undefined);
  const info = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("#menu article img")).slice(0, 4);
    return imgs.map((img) => ({
      src: (img.getAttribute("src") || "").slice(0, 90),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      w: Math.round(img.getBoundingClientRect().width),
      h: Math.round(img.getBoundingClientRect().height),
      opacity: getComputedStyle(img).opacity,
    }));
  });
  process.stdout.write(JSON.stringify(info, null, 2) + "\n");
  await page.screenshot({ path: "tmp/product-grid-qa/desktop-images.png" });
  await browser.close();
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
