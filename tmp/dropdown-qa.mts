import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync } from "fs";
import { chromium, type Locator, type Page } from "playwright-core";

const BASE = "http://localhost:3001";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function record(name: string, pass: boolean, detail?: string) {
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!pass) failed += 1;
}

let failed = 0;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(page: Page) {
  if (!PASSWORD) throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing");
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("#email").waitFor({ timeout: 20000 });
  await sleep(4000);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 60000 });
}

async function openBreakEven(page: Page) {
  await page.goto(`${BASE}/admin/costing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "כספים" }).first().click();
  await page.getByRole("button", { name: "נקודת איזון" }).click();
  await page.locator("#be-fixed").waitFor({ timeout: 20000 });
}

async function scrollY(page: Page) {
  return page.evaluate(() => window.scrollY);
}

async function cardHeight(page: Page) {
  return page.locator("#be-fixed").evaluate((node) => Math.round(node.getBoundingClientRect().height));
}

async function place(locator: Locator, edge: "top" | "bottom") {
  await locator.evaluate((node, edge) => {
    const rect = node.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const target = edge === "top" ? 88 : window.innerHeight - rect.height - 20;
    window.scrollTo(0, Math.max(0, top - target));
  }, edge);
  await sleep(150);
}

type MenuInfo = {
  portaled: boolean;
  insideCard: boolean;
  position: string;
  direction: string;
  background: string;
  borderWidth: string;
  shadow: string;
  overflowY: string;
  maxHeight: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  scrollHeight: number;
  clientHeight: number;
  triggerWidth: number;
  triggerTop: number;
  triggerBottom: number;
  spaceBelow: number;
  spaceAbove: number;
  scrollY: number;
  cardHeight: number;
  docScrollWidth: number;
  docClientWidth: number;
  innerWidth: number;
  innerHeight: number;
  cardOverflowY: string;
  cardScrollGap: number;
  tableOverflowY: string;
  selectedClass: string;
};

async function readMenu(page: Page, trigger: Locator): Promise<MenuInfo | null> {
  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) return null;
  return page.evaluate((box) => {
    const menu = document.querySelector<HTMLElement>("[data-anchored-menu]");
    const card = document.getElementById("be-fixed");
    if (!menu || !card) return null;
    const rect = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const cardStyle = getComputedStyle(card);
    const table = card.querySelector<HTMLElement>(".overflow-x-auto");
    const selected = menu.querySelector<HTMLElement>("[aria-selected='true']");
    return {
      portaled: menu.parentElement === document.body,
      insideCard: card.contains(menu),
      position: style.position,
      direction: style.direction,
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      shadow: style.boxShadow,
      overflowY: style.overflowY,
      maxHeight: Number.parseFloat(style.maxHeight),
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      triggerWidth: box.width,
      triggerTop: box.y,
      triggerBottom: box.y + box.height,
      spaceBelow: window.innerHeight - (box.y + box.height),
      spaceAbove: box.y,
      scrollY: window.scrollY,
      cardHeight: Math.round(card.getBoundingClientRect().height),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      cardOverflowY: cardStyle.overflowY,
      cardScrollGap: card.scrollHeight - card.clientHeight,
      tableOverflowY: table ? getComputedStyle(table).overflowY : "missing",
      selectedClass: selected?.className ?? "",
    };
  }, triggerBox);
}

function assertMenu(name: string, info: MenuInfo | null, expectSide: "below" | "above") {
  if (!info) {
    record(name, false, "menu missing");
    return;
  }
  const sideOk =
    expectSide === "below"
      ? info.top >= info.triggerBottom - 1 && info.top <= info.triggerBottom + 12
      : info.bottom <= info.triggerTop + 1 && info.bottom >= info.triggerTop - 12;
  const widthOk = Math.abs(info.width - info.triggerWidth) <= 2 || info.width <= info.innerWidth - 16;
  const available = expectSide === "below" ? info.spaceBelow - 12 : info.spaceAbove - 12;
  const heightOk = info.maxHeight <= 240.5 && info.maxHeight <= available + 8 && info.height <= info.maxHeight + 2;
  const inside =
    info.left >= 7 && info.right <= info.innerWidth - 7 && info.top >= -1 && info.bottom <= info.innerHeight + 1;
  const white = info.background === "rgb(255, 255, 255)";
  record(
    name,
    info.portaled &&
      !info.insideCard &&
      info.position === "fixed" &&
      info.direction === "rtl" &&
      white &&
      Number.parseFloat(info.borderWidth) > 0 &&
      info.shadow !== "none" &&
      info.overflowY === "auto" &&
      sideOk &&
      widthOk &&
      heightOk &&
      inside,
    JSON.stringify({
      side: expectSide,
      sideOk,
      widthOk,
      heightOk,
      inside,
      top: Math.round(info.top),
      bottom: Math.round(info.bottom),
      triggerTop: Math.round(info.triggerTop),
      triggerBottom: Math.round(info.triggerBottom),
      width: Math.round(info.width),
      triggerWidth: Math.round(info.triggerWidth),
      maxHeight: Math.round(info.maxHeight),
      height: Math.round(info.height),
      position: info.position,
      direction: info.direction,
      background: info.background,
      overflowY: info.overflowY,
      portaled: info.portaled,
    })
  );
}

async function main() {
  if (!existsSync(CHROME)) throw new Error("chrome missing");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(page);
    await openBreakEven(page);
    const rowsBefore = await page.locator("#be-fixed tbody tr").count();
    await page.getByRole("button", { name: "+ הוצאה קבועה" }).click();
    const form = page.locator("[data-fixed-form]");
    await form.waitFor();
    const period = form.locator("label").filter({ hasText: "תקופה לנקודת איזון" }).locator("button");
    const payment = form.locator("label").filter({ hasText: "תדירות תשלום" }).locator("button");
    const category = form.locator("label").filter({ hasText: "קטגוריה" }).locator("input");

    const fields = form.locator("input, button");
    const fieldCount = await fields.count();
    let fieldsVisible = fieldCount >= 8;
    for (let index = 0; index < fieldCount; index += 1) {
      const box = await fields.nth(index).boundingBox();
      if (!box || box.width < 40 || box.height < 20) fieldsVisible = false;
    }
    const cardBox = await page.locator("#be-fixed").boundingBox();
    let fieldsInside = true;
    for (let index = 0; index < fieldCount; index += 1) {
      const box = await fields.nth(index).boundingBox();
      if (!box || !cardBox) {
        fieldsInside = false;
        continue;
      }
      if (box.x < cardBox.x - 1 || box.x + box.width > cardBox.x + cardBox.width + 1) fieldsInside = false;
    }
    record("form fields stay visible inside the card", fieldsVisible && fieldsInside, `fields=${fieldCount}`);

    await place(category, "top");
    const heightBefore = await cardHeight(page);
    const scrollBefore = await scrollY(page);
    const belowBefore = await page.locator("#be-dishes").boundingBox();
    await category.click();
    await page.locator("[data-anchored-menu]").waitFor();
    await sleep(100);
    const opened = await readMenu(page, category);
    record("opening at the top does not change card height", opened?.cardHeight === heightBefore, `${heightBefore} -> ${opened?.cardHeight}`);
    record("opening at the top does not scroll the page", opened != null && Math.abs(opened.scrollY - scrollBefore) < 1, `${scrollBefore} -> ${opened?.scrollY}`);
    const belowAfter = await page.locator("#be-dishes").boundingBox();
    record(
      "opening does not push content down",
      !!belowBefore && !!belowAfter && Math.abs(belowAfter.y - belowBefore.y) < 1,
      `${belowBefore?.y} -> ${belowAfter?.y}`
    );
    assertMenu("category list opens below the field", opened, "below");
    record(
      "category list scrolls inside itself",
      !!opened && opened.scrollHeight > opened.clientHeight && opened.clientHeight <= 241,
      `scroll=${opened?.scrollHeight} client=${opened?.clientHeight}`
    );
    const scrollAtOpen = await scrollY(page);
    await page.locator("[data-anchored-menu]").evaluate((node) => {
      node.scrollTop = 80;
    });
    await sleep(50);
    record("scrolling the list does not scroll the page", Math.abs((await scrollY(page)) - scrollAtOpen) < 1);
    const selected = page.locator("[data-anchored-menu] [aria-selected='true']");
    record(
      "selected category is highlighted",
      (await selected.innerText()).includes("אחר") && ((await selected.getAttribute("class")) ?? "").includes("bg-turquoise/15")
    );
    await page.locator("[data-anchored-menu]").getByRole("option", { name: "שכירות" }).click();
    await sleep(100);
    record("category selection updates the field", (await category.inputValue()).includes("שכירות"));
    record("category selection closes the list", (await page.locator("[data-anchored-menu]").count()) === 0);
    record("category selection does not scroll the page", Math.abs((await scrollY(page)) - scrollBefore) < 2);

    await place(period, "top");
    const periodScroll = await scrollY(page);
    const periodHeight = await cardHeight(page);
    await period.click();
    await page.locator("[data-anchored-menu]").waitFor();
    const periodMenu = await readMenu(page, period);
    record("period list at the top keeps card height and scroll", periodMenu?.cardHeight === periodHeight && Math.abs((periodMenu?.scrollY ?? 0) - periodScroll) < 1);
    assertMenu("period list opens below the field", periodMenu, "below");
    await page.keyboard.press("Escape");
    await sleep(80);
    record("Escape closes the list", (await page.locator("[data-anchored-menu]").count()) === 0);
    record("Escape does not jump the page", Math.abs((await scrollY(page)) - periodScroll) < 1);
    await period.click();
    await page.locator("[data-anchored-menu]").waitFor();
    await page.mouse.click(8, 8);
    await sleep(80);
    record("outside click closes the list", (await page.locator("[data-anchored-menu]").count()) === 0);
    record("outside click does not jump the page", Math.abs((await scrollY(page)) - periodScroll) < 1);

    await period.focus();
    await page.keyboard.press("ArrowDown");
    await page.locator("[data-anchored-menu]").waitFor();
    await sleep(200);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await sleep(80);
    record("keyboard opens and selects a period", (await period.innerText()).includes("שנתי") && (await page.locator("[data-anchored-menu]").count()) === 0);

    await place(payment, "bottom");
    const paymentBox = await payment.boundingBox();
    const viewport = page.viewportSize();
    const nearBottom = !!paymentBox && !!viewport && paymentBox.y + paymentBox.height > viewport.height - 80;
    record("payment field can sit near the bottom", nearBottom, paymentBox ? `y=${Math.round(paymentBox.y)} h=${viewport?.height}` : "no box");
    const lowScroll = await scrollY(page);
    const lowHeight = await cardHeight(page);
    await payment.click();
    await page.locator("[data-anchored-menu]").waitFor();
    await sleep(80);
    const paymentMenu = await readMenu(page, payment);
    record("opening at the bottom keeps card height and scroll", paymentMenu?.cardHeight === lowHeight && Math.abs((paymentMenu?.scrollY ?? 0) - lowScroll) < 1);
    assertMenu("payment list opens above the field", paymentMenu, "above");
    await page.locator("[data-anchored-menu]").getByRole("option", { name: "רבעוני" }).click();
    await sleep(80);
    record("payment selection updates the field", (await payment.innerText()).includes("רבעוני"));
    record("payment selection does not scroll the page", Math.abs((await scrollY(page)) - lowScroll) < 2);

    await page.getByRole("button", { name: "ביטול" }).click();
    await sleep(200);
    const bars = await page.evaluate(() => {
      const card = document.getElementById("be-fixed");
      const table = card?.querySelector<HTMLElement>(".overflow-x-auto");
      return {
        cardOverflowY: card ? getComputedStyle(card).overflowY : "missing",
        tableOverflowY: table ? getComputedStyle(table).overflowY : "missing",
        tableVerticalGap: table ? table.scrollHeight - table.clientHeight : -1,
      };
    });
    record(
      "expenses card has no extra vertical scrollbar",
      bars.cardOverflowY !== "auto" && bars.cardOverflowY !== "scroll" && bars.tableOverflowY === "hidden" && bars.tableVerticalGap <= 1,
      JSON.stringify(bars)
    );
    record("cancel leaves the saved rows unchanged", (await page.locator("#be-fixed tbody tr").count()) === rowsBefore);
    record("no page errors on desktop", errors.length === 0, errors.join(" | "));

    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    await page.getByRole("button", { name: "+ הוצאה קבועה" }).click();
    await form.waitFor();
    const mobileFields = form.locator("input, button");
    const mobileCount = await mobileFields.count();
    let mobileFit = mobileCount >= 8;
    const mobileCard = await page.locator("#be-fixed").boundingBox();
    for (let index = 0; index < mobileCount; index += 1) {
      const box = await mobileFields.nth(index).boundingBox();
      if (!box || !mobileCard || box.width < 40 || box.x < -1 || box.x + box.width > 391) mobileFit = false;
    }
    record("mobile form fields stay inside the screen", mobileFit, `fields=${mobileCount} card=${mobileCard ? Math.round(mobileCard.width) : 0}`);
    const pageWidth = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    record("mobile page has no horizontal scroll before opening", pageWidth.scroll <= pageWidth.client + 1, `${pageWidth.scroll}/${pageWidth.client}`);
    const mobileBars = await page.evaluate(() => {
      const card = document.getElementById("be-fixed");
      const table = card?.querySelector<HTMLElement>(".overflow-x-auto");
      return {
        tableOverflowY: table ? getComputedStyle(table).overflowY : "missing",
        tableVerticalGap: table ? table.scrollHeight - table.clientHeight : -1,
      };
    });
    record(
      "mobile expenses card has no extra vertical scrollbar",
      mobileBars.tableOverflowY === "hidden" && mobileBars.tableVerticalGap <= 1,
      JSON.stringify(mobileBars)
    );

    await place(category, "top");
    const mobileScroll = await scrollY(page);
    const mobileHeight = await cardHeight(page);
    await category.tap();
    await page.locator("[data-anchored-menu]").waitFor();
    await sleep(100);
    const mobileMenu = await readMenu(page, category);
    record("mobile opening keeps card height and scroll", mobileMenu?.cardHeight === mobileHeight && Math.abs((mobileMenu?.scrollY ?? 0) - mobileScroll) < 1);
    assertMenu("mobile category list stays inside the screen", mobileMenu, "below");
    record(
      "mobile opening does not create horizontal scroll",
      !!mobileMenu && mobileMenu.docScrollWidth <= mobileMenu.docClientWidth + 1,
      `${mobileMenu?.docScrollWidth}/${mobileMenu?.docClientWidth}`
    );
    await page.locator("[data-anchored-menu]").getByRole("option", { name: "חשמל" }).tap();
    await sleep(80);
    record("mobile touch selects a category", (await category.inputValue()).includes("חשמל"));

    await place(payment, "bottom");
    const mobilePaymentBox = await payment.boundingBox();
    record(
      "mobile payment field can sit near the bottom",
      !!mobilePaymentBox && mobilePaymentBox.y + mobilePaymentBox.height > 844 - 90,
      mobilePaymentBox ? `y=${Math.round(mobilePaymentBox.y)}` : "no box"
    );
    const mobileLowScroll = await scrollY(page);
    await payment.tap();
    await page.locator("[data-anchored-menu]").waitFor();
    const mobilePayment = await readMenu(page, payment);
    record("mobile bottom opening does not scroll the page", mobilePayment != null && Math.abs(mobilePayment.scrollY - mobileLowScroll) < 1);
    assertMenu("mobile payment list opens above the field", mobilePayment, "above");
    record(
      "mobile bottom list does not create horizontal scroll",
      !!mobilePayment && mobilePayment.docScrollWidth <= mobilePayment.docClientWidth + 1,
      `${mobilePayment?.docScrollWidth}/${mobilePayment?.docClientWidth}`
    );
    await page.locator("[data-anchored-menu]").getByRole("option", { name: "חד־פעמי" }).tap();
    record("mobile touch selects a payment frequency", (await payment.innerText()).includes("חד־פעמי"));
    await page.getByRole("button", { name: "ביטול" }).click();
    record("mobile cancel leaves the saved rows unchanged", (await page.locator("#be-fixed tbody tr").count()) === rowsBefore);
    record("no page errors", errors.length === 0, errors.join(" | "));
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
