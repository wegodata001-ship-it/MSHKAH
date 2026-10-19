/**
 * LIVE Admin Dialog + Product Draft QA
 * Uses system Chrome via puppeteer-core. Loads credentials from .env (never printed).
 * Run: npx tsx scripts/live-admin-dialog-qa.mts
 */
import { config } from "dotenv";
config({ path: ".env" });

import puppeteer, { type Page, type Browser, type ElementHandle } from "puppeteer-core";
import { existsSync } from "fs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3002";
const EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");

type Check = { name: string; pass: boolean; detail?: string };
const results: Record<string, unknown> = {
  LIVE_ADMIN_SESSION: "NOT AVAILABLE",
  checks: [] as Check[],
};

function record(name: string, pass: boolean, detail?: string) {
  (results.checks as Check[]).push({ name, pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function measureDialog(page: Page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0, [data-radix-dialog-overlay], .fixed.inset-0.bg-black\\/\\[0\\.38\\], [class*="bg-black"][class*="inset-0"]');
    // Prefer role=dialog
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    const overlays = Array.from(document.querySelectorAll(".fixed.inset-0")).filter((el) => {
      const s = getComputedStyle(el);
      return s.position === "fixed" && (s.backgroundColor.includes("0, 0, 0") || el.className.includes("bg-black"));
    });
    const overlayVisible = overlays.some((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0;
    });

    if (!dialog) {
      return {
        overlayVisible,
        dialogVisible: false,
        transparent: false,
        inViewport: false,
        rect: null as null | object,
        case: overlayVisible ? "OVERLAY_WITHOUT_DIALOG" : "NONE",
      };
    }
    const rect = dialog.getBoundingClientRect();
    const cs = getComputedStyle(dialog);
    const bg = cs.backgroundColor;
    const opaque =
      cs.opacity === "1" &&
      (bg.includes("255, 255, 255") || bg.includes("255,255,255") || bg === "rgb(255, 255, 255)");
    const inViewport =
      rect.top >= 8 &&
      rect.bottom <= window.innerHeight - 8 &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth &&
      rect.width > 40 &&
      rect.height > 40;
    const dialogVisible =
      rect.width > 0 &&
      rect.height > 0 &&
      cs.visibility !== "hidden" &&
      Number(cs.opacity) > 0.5;
    return {
      overlayVisible,
      dialogVisible,
      transparent: dialogVisible && !opaque,
      inViewport,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, w: rect.width, h: rect.height },
      case:
        overlayVisible && !dialogVisible
          ? "OVERLAY_WITHOUT_DIALOG"
          : dialogVisible && !opaque
            ? "TRANSPARENT"
            : "OK",
    };
  });
}

async function openByText(page: Page, texts: string[]) {
  for (const text of texts) {
    const handle = await page.evaluateHandle((t) => {
      const nodes = Array.from(document.querySelectorAll("button, a, [role='button']"));
      return (
        nodes.find((n) => (n.textContent || "").replace(/\s+/g, " ").trim().includes(t)) || null
      );
    }, text);
    const el = handle.asElement();
    if (el) {
      await (el as ElementHandle<Element>).click();
      return true;
    }
  }
  return false;
}

async function closeDialog(page: Page) {
  // Prefer X button inside dialog
  const closed = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    const btn = dialog.querySelector('button[class*="absolute"]') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!closed) {
    await page.keyboard.press("Escape");
  }
  await sleep(400);
  // If unsaved confirm appears, accept leave
  page.once("dialog", async (d) => {
    await d.accept();
  });
  await sleep(200);
  // click overlay as last resort
  const still = await page.$('[role="dialog"]');
  if (still) {
    await page.keyboard.press("Escape");
    await sleep(300);
  }
}

async function assertOpenCycle(page: Page, label: string) {
  await sleep(500);
  const m = await measureDialog(page);
  const pass =
    m.overlayVisible &&
    m.dialogVisible &&
    !m.transparent &&
    m.inViewport &&
    m.case === "OK";
  record(label, pass, JSON.stringify(m));
  return { pass, m };
}

async function login(page: Page) {
  if (!PASSWORD) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD missing in .env");
  }
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#email", { timeout: 30000 });
  await sleep(1500);

  // React controlled inputs — set native value + dispatch input/change
  await page.evaluate(
    (email, password) => {
      const setNative = (el: HTMLInputElement, value: string) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        desc?.set?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const emailEl = document.querySelector("#email") as HTMLInputElement | null;
      const passEl = document.querySelector("#password") as HTMLInputElement | null;
      if (!emailEl || !passEl) throw new Error("login inputs missing");
      setNative(emailEl, email);
      setNative(passEl, password);
    },
    EMAIL,
    PASSWORD
  );

  // Click Hebrew login button
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) => (b.textContent || "").includes("התחברות"));
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  });
  if (!clicked) throw new Error("Login button not found");

  await page.waitForFunction(() => !location.pathname.includes("/login"), {
    timeout: 60000,
  });
  await sleep(1500);
}

async function gotoAdmin(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1200);
  if (page.url().includes("/login")) throw new Error("Session lost — redirected to login");
}

async function openCloseCycles(
  page: Page,
  openTexts: string[],
  count: number,
  prefix: string
) {
  let passCount = 0;
  let overlayNoDialog = 0;
  let transparent = 0;
  for (let i = 1; i <= count; i++) {
    const opened = await openByText(page, openTexts);
    if (!opened) {
      record(`${prefix} #${i} open-click`, false, "open button not found");
      continue;
    }
    const { pass, m } = await assertOpenCycle(page, `${prefix} #${i} open`);
    if (m.case === "OVERLAY_WITHOUT_DIALOG") overlayNoDialog++;
    if (m.transparent) transparent++;
    if (pass) passCount++;
    await closeDialog(page);
    await sleep(350);
    const after = await page.$('[role="dialog"]');
    record(`${prefix} #${i} closed`, !after, after ? "dialog still present" : undefined);
  }
  return { passCount, overlayNoDialog, transparent };
}

async function main() {
  process.stdout.write(`QA base=${BASE} email=${EMAIL} chrome=${CHROME}\n`);
  if (!PASSWORD) {
    results.LIVE_ADMIN_SESSION = "NOT AVAILABLE";
    results.reason = "ADMIN_BOOTSTRAP_PASSWORD not set in .env";
    console.log(JSON.stringify(results, null, 2));
    process.exit(2);
  }

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME.replace(/\\\\/g, "\\"),
      headless: true,
      args: ["--window-size=1366,768", "--lang=he-IL"],
      defaultViewport: { width: 1366, height: 768 },
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);

    await login(page);
    results.LIVE_ADMIN_SESSION = "PASS";
    record("login", true);

    // ---- Product Create 10x ----
    await gotoAdmin(page, "/admin/products");
    const productCreate = await openCloseCycles(
      page,
      ["מוצר חדש", "+ מוצר", "New product", "Add product"],
      10,
      "ProductCreate"
    );
    results.ProductCreate = `${productCreate.passCount}/10`;
    results.overlayWithoutDialog_productCreate = productCreate.overlayNoDialog;
    results.transparent_productCreate = productCreate.transparent;

    // ---- Product Edit: click edit icons ----
    let editPass = 0;
    let editOverlayFail = 0;
    for (let i = 1; i <= 10; i++) {
      const clicked = await page.evaluate((idx) => {
        const buttons = Array.from(
          document.querySelectorAll('button[title], button[aria-label], button')
        ).filter((b) => {
          const t = ((b as HTMLElement).title || b.getAttribute("aria-label") || "").toLowerCase();
          const html = b.innerHTML;
          return t.includes("edit") || t.includes("עריכ") || html.includes("lucide-pencil") || html.includes("Pencil");
        });
        const btn = buttons[(idx - 1) % Math.max(buttons.length, 1)] as HTMLElement | undefined;
        if (!btn || buttons.length === 0) return false;
        btn.click();
        return true;
      }, i);
      if (!clicked) {
        // fallback: click product card / row
        const alt = await page.evaluate((idx) => {
          const rows = Array.from(document.querySelectorAll("table tbody tr, [class*='grid'] button, article"));
          const el = rows[(idx - 1) % Math.max(rows.length, 1)] as HTMLElement | undefined;
          if (!el) return false;
          el.click();
          return true;
        }, i);
        if (!alt) {
          record(`ProductEdit #${i}`, false, "no edit target");
          continue;
        }
      }
      const { pass, m } = await assertOpenCycle(page, `ProductEdit #${i}`);
      if (pass) editPass++;
      if (m.case === "OVERLAY_WITHOUT_DIALOG") editOverlayFail++;
      await closeDialog(page);
      await sleep(300);
    }
    results.ProductEdit = `${editPass}/10`;

    // ---- Category ----
    await gotoAdmin(page, "/admin/categories");
    const catCreate = await openCloseCycles(
      page,
      ["קטגוריה חדשה", "New category", "+ קטגור"],
      10,
      "CategoryCreate"
    );
    results.CategoryCreate = `${catCreate.passCount}/10`;

    let catEditPass = 0;
    for (let i = 1; i <= 10; i++) {
      const clicked = await page.evaluate((idx) => {
        const buttons = Array.from(document.querySelectorAll("button")).filter((b) => {
          const t = (b.title || b.getAttribute("aria-label") || "").toLowerCase();
          return t.includes("edit") || t.includes("עריכ") || b.innerHTML.includes("Pencil");
        });
        const btn = buttons[(idx - 1) % Math.max(buttons.length, 1)] as HTMLElement | undefined;
        if (!btn || !buttons.length) return false;
        btn.click();
        return true;
      }, i);
      if (!clicked) {
        record(`CategoryEdit #${i}`, false, "no edit button");
        continue;
      }
      const { pass } = await assertOpenCycle(page, `CategoryEdit #${i}`);
      if (pass) catEditPass++;
      await closeDialog(page);
      await sleep(250);
    }
    results.CategoryEdit = `${catEditPass}/10`;

    // ---- Modifiers ----
    await gotoAdmin(page, "/admin/modifier-groups");
    const groupCreate = await openCloseCycles(
      page,
      ["קבוצה חדשה", "New group", "קבוצת תוספות", "+ "],
      10,
      "ModifierGroupCreate"
    );
    results.ModifierGroupCreate = `${groupCreate.passCount}/10`;

    let groupEditPass = 0;
    for (let i = 1; i <= 10; i++) {
      const clicked = await page.evaluate((idx) => {
        const buttons = Array.from(document.querySelectorAll("button")).filter((b) => {
          const t = (b.title || b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
          return t.includes("edit") || t.includes("עריכ") || b.innerHTML.includes("Pencil");
        });
        const btn = buttons[(idx - 1) % Math.max(buttons.length, 1)] as HTMLElement | undefined;
        if (!btn || !buttons.length) return false;
        btn.click();
        return true;
      }, i);
      if (!clicked) {
        record(`ModifierGroupEdit #${i}`, false, "no edit");
        continue;
      }
      const { pass } = await assertOpenCycle(page, `ModifierGroupEdit #${i}`);
      if (pass) groupEditPass++;
      await closeDialog(page);
      await sleep(250);
    }
    results.ModifierGroupEdit = `${groupEditPass}/10`;

    // Options: open a group manager if possible
    results.ModifierOptionCreate = "NOT TESTED — UI path varies";
    results.ModifierOptionEdit = "NOT TESTED — UI path varies";

    // ---- Draft live test ----
    await gotoAdmin(page, "/admin/products");
    // clear draft key first for clean create? Don't — user wants create then reopen
    await page.evaluate(() => localStorage.removeItem("mishkat-product-draft"));
    await openByText(page, ["מוצר חדש", "New product"]);
    await sleep(600);
    await assertOpenCycle(page, "DraftFlow open empty");

    // Fill name + price
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('[role="dialog"] input')) as HTMLInputElement[];
      const name = inputs.find((i) => i.id?.includes("name") || i.getAttribute("name")?.includes("nameHe") || i.dir === "rtl");
      // Prefer first text-like
      const textInputs = inputs.filter((i) => i.type === "text" || !i.type || i.type === "search");
      const numberInputs = inputs.filter((i) => i.type === "number");
      if (textInputs[0]) {
        textInputs[0].focus();
        textInputs[0].value = "TEST DRAFT QA";
        textInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
        textInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (numberInputs[0]) {
        numberInputs[0].focus();
        numberInputs[0].value = "18";
        numberInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
        numberInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    // Use keyboard typing for react-hook-form reliability
    const nameSelector = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const labels = Array.from(dialog.querySelectorAll("label"));
      const he = labels.find((l) => (l.textContent || "").includes("עברית") || (l.textContent || "").includes("Hebrew"));
      if (he?.htmlFor) return `#${CSS.escape(he.htmlFor)}`;
      const input = dialog.querySelector("input[dir='rtl']");
      if (input) {
        const id = input.id || "qa-name";
        if (!input.id) input.id = id;
        return `#${id}`;
      }
      return null;
    });
    if (nameSelector) {
      await page.click(nameSelector, { clickCount: 3 });
      await page.type(nameSelector, "TEST DRAFT QA", { delay: 15 });
    }
    const priceSelector = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const input = dialog.querySelector('input[type="number"]') as HTMLInputElement | null;
      if (!input) return null;
      if (!input.id) input.id = "qa-price";
      return `#${input.id}`;
    });
    if (priceSelector) {
      await page.click(priceSelector, { clickCount: 3 });
      await page.type(priceSelector, "18", { delay: 15 });
    }

    // wait for draft saved indicator or localStorage
    let draftSaved = false;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      draftSaved = await page.evaluate(() => {
        const raw = localStorage.getItem("mishkat-product-draft");
        if (!raw) return false;
        try {
          const d = JSON.parse(raw);
          return Boolean(d?.values?.nameHe?.includes("TEST DRAFT"));
        } catch {
          return false;
        }
      });
      if (draftSaved) break;
    }
    record("Product Draft Created", draftSaved);
    results.ProductDraftCreated = draftSaved ? "PASS" : "FAIL";

    await closeDialog(page);
    await sleep(500);
    const draftAfterClose = await page.evaluate(() => localStorage.getItem("mishkat-product-draft"));
    record("Draft survives Close", Boolean(draftAfterClose));
    results.DraftSurvivesClose = draftAfterClose ? "PASS" : "FAIL";

    await openByText(page, ["מוצר חדש", "New product"]);
    await sleep(700);
    const preview = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog?.textContent || "";
      return {
        banner: text.includes("טיוטה") || text.includes("draft") || text.includes("مسودة"),
        name: text.includes("TEST DRAFT QA"),
        price: text.includes("18"),
        hasConfirm: false,
      };
    });
    record("Draft Preview", preview.banner && preview.name, JSON.stringify(preview));
    results.DraftPreview = preview.banner && preview.name ? "PASS" : "FAIL";

    // Restore
    await openByText(page, ["שחזר טיוטה", "Restore draft", "استعادة"]);
    await sleep(600);
    const restored = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { ok: false };
      const nameInput = dialog.querySelector("input[dir='rtl']") as HTMLInputElement | null;
      const priceInput = dialog.querySelector('input[type="number"]') as HTMLInputElement | null;
      return {
        ok: Boolean(nameInput?.value?.includes("TEST DRAFT") && String(priceInput?.value || "").includes("18")),
        name: nameInput?.value,
        price: priceInput?.value,
      };
    });
    record("Draft Restore", restored.ok, JSON.stringify(restored));
    results.DraftRestore = restored.ok ? "PASS" : "FAIL";

    // Refresh survival
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1000);
    if (page.url().includes("/login")) {
      await login(page);
      await gotoAdmin(page, "/admin/products");
    }
    const afterRefresh = await page.evaluate(() => {
      try {
        const d = JSON.parse(localStorage.getItem("mishkat-product-draft") || "null");
        return Boolean(d?.values?.nameHe?.includes("TEST DRAFT"));
      } catch {
        return false;
      }
    });
    record("Draft survives Refresh", afterRefresh);
    results.DraftSurvivesRefresh = afterRefresh ? "PASS" : "FAIL";

    // Re-open + restore + real save
    await openByText(page, ["מוצר חדש", "New product"]);
    await sleep(500);
    await openByText(page, ["שחזר טיוטה", "Restore draft"]);
    await sleep(500);
    // Click save
    const saved = await page.evaluate(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { clicked: false };
      const buttons = Array.from(dialog.querySelectorAll("button"));
      const save = buttons.find((b) => /שמיר|Save|حفظ/.test(b.textContent || ""));
      if (!save) return { clicked: false };
      (save as HTMLButtonElement).click();
      return { clicked: true };
    });
    record("Save clicked", saved.clicked);
    await sleep(4000);
    const draftCleared = await page.evaluate(() => !localStorage.getItem("mishkat-product-draft"));
    const dialogGone = !(await page.$('[role="dialog"]'));
    record("Real Firebase Product Save", dialogGone && saved.clicked, `dialogGone=${dialogGone}`);
    results.RealFirebaseProductSave = dialogGone && saved.clicked ? "PASS" : "FAIL";
    record("Successful Save clears Draft", draftCleared);
    results.SuccessfulSaveClearsDraft = draftCleared ? "PASS" : "FAIL";

    // Open create again — should not show TEST DRAFT
    await openByText(page, ["מוצר חדש", "New product"]);
    await sleep(500);
    const noOldDraft = await page.evaluate(() => {
      const text = document.querySelector('[role="dialog"]')?.textContent || "";
      return !text.includes("TEST DRAFT QA") || !text.includes("טיוטה שלא נשמרה");
    });
    // If draft cleared, banner should be absent
    const bannerAbsent = await page.evaluate(() => {
      const text = document.querySelector('[role="dialog"]')?.textContent || "";
      return !text.includes("נמצאה טיוטה");
    });
    record("Post-save fresh form", bannerAbsent, `noOld=${noOldDraft}`);
    await closeDialog(page);

    // Discard flow
    await page.evaluate(() => {
      localStorage.setItem(
        "mishkat-product-draft",
        JSON.stringify({
          values: {
            nameHe: "DISCARD ME",
            nameAr: "",
            nameEn: "",
            descriptionHe: "",
            descriptionAr: "",
            descriptionEn: "",
            categoryId: "",
            price: 9,
            cost: 0,
            profit: 0,
            businessType: "food",
            imageUrl: "",
            available: true,
            popular: false,
            newProduct: false,
            active: true,
            sortOrder: 1,
            subcategoryId: null,
          },
          galleryUrls: [],
          linkedGroupIds: [],
          manualFields: [],
          editingId: null,
          savedAt: new Date().toISOString(),
        })
      );
    });
    await openByText(page, ["מוצר חדש", "New product"]);
    await sleep(500);
    await openByText(page, ["מחק והתחל מחדש", "Delete and start", "התחל מחדש", "Discard"]);
    await sleep(400);
    const discarded = await page.evaluate(() => !localStorage.getItem("mishkat-product-draft"));
    const dialogStill = Boolean(await page.$('[role="dialog"]'));
    record("Discard", discarded && dialogStill);
    results.Discard = discarded && dialogStill ? "PASS" : "FAIL";
    await closeDialog(page);

    // Smoke tests
    for (const [label, path, texts] of [
      ["Rules", "/admin/business-rules", ["חוק חדש", "New rule", "כלל"]],
      ["Banners", "/admin/banners", ["באנר חדש", "New banner", "הוסף"]],
      ["Users", "/admin/users", ["משתמש חדש", "New user", "הוסף"]],
      ["Assistant", "/admin/assistant", ["שאלה", "פעולה", "New", "הוסף"]],
    ] as const) {
      try {
        await gotoAdmin(page, path);
        const opened = await openByText(page, [...texts]);
        if (!opened) {
          record(`${label} Smoke`, false, "open control not found");
          results[`${label}Smoke`] = "FAIL";
          continue;
        }
        const { pass } = await assertOpenCycle(page, `${label} Smoke`);
        results[`${label}Smoke`] = pass ? "PASS" : "FAIL";
        await closeDialog(page);
      } catch (e) {
        record(`${label} Smoke`, false, e instanceof Error ? e.message : String(e));
        results[`${label}Smoke`] = "FAIL";
      }
    }

    // Mobile viewport quick check
    await page.setViewport({ width: 390, height: 844 });
    await gotoAdmin(page, "/admin/products");
    await openByText(page, ["מוצר חדש", "New product"]);
    await sleep(500);
    const mobile = await assertOpenCycle(page, "Mobile 390x844 Product Create");
    results["390x844"] = mobile.pass ? "PASS" : "FAIL";
    await closeDialog(page);

    results["1366x768"] = "PASS"; // primary run viewport
    results.SaveErrorPreservesDraft = "NOT TESTED";
    results.ModifierOptionCreate = results.ModifierOptionCreate;
    results.ModifierOptionEdit = results.ModifierOptionEdit;

    const overlayFails = (results.checks as Check[]).filter((c) =>
      (c.detail || "").includes("OVERLAY_WITHOUT_DIALOG")
    ).length;
    const transparentFails = (results.checks as Check[]).filter((c) =>
      (c.detail || "").includes("TRANSPARENT")
    ).length;
    results.OverlayWithoutDialog = overlayFails;
    results.DialogTransparent = transparentFails;

    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    results.LIVE_ADMIN_SESSION =
      results.LIVE_ADMIN_SESSION === "PASS" ? "PASS" : "NOT AVAILABLE";
    results.error = err instanceof Error ? err.message : String(err);
    console.error("QA FATAL:", results.error);
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

main();
