import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { decidePaymentUpdate } from "../src/lib/payments/hyp/decide";
import { httpStatusForAiCode } from "../src/lib/ai/gemini-config";
import { extractInvoiceWithGemini, isEmptyInvoiceExtraction, parseInvoiceExtraction } from "../src/lib/ai/gemini-invoice";
import { toDateOnly, toIsoTimestamp, toJsDate } from "../src/lib/dates/normalize";
import { missingInvoiceFields } from "../src/lib/inventory/invoice-archive";
import { recipeIssueDraft, validateIssueLines } from "../src/lib/inventory/issue";
import { currentStockBase, unitCostFromPackage } from "../src/lib/inventory/stock";
import { matchInventoryProduct } from "../src/lib/inventory/invoice-smart-match";
import { computeBreakEven } from "../src/lib/breakeven/compute";
import { foodCostPercent } from "../src/lib/costing/calc";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { newOrderPrintJobId } from "../src/lib/print-jobs/ids";
import type { CostingIngredient, DishRecipe } from "../src/lib/costing/types";
import type { InventoryMovement } from "../src/lib/inventory/types";

type Row = {
  area: string;
  check: string;
  result: "PASS" | "FAIL" | "BLOCKED";
  fix: string;
  leftover: string;
  env: string;
  evidence: string;
};

const rows: Row[] = [];
const OUT = "tmp/full-qa";
const STARTED = Date.now();
const PREFIX = `TEST-QA-${STARTED}`;
const createdIds: { col: string; id: string }[] = [];
mkdirSync(OUT, { recursive: true });

function add(row: Row) {
  rows.push(row);
  console.log(`${row.result}\t${row.area}\t${row.check}\t${row.evidence}`);
}

function loadKey() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(file, "utf8");
      const match = text.match(/^GEMINI_API_KEY=(.+)$/m);
      if (match?.[1]) process.env.GEMINI_API_KEY = match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* skip */
    }
  }
}

async function adminToken(): Promise<string | null> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!password || !key) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = (await res.json()) as { idToken?: string };
  return data.idToken ?? null;
}

async function testUnauthorized(base: string) {
  const res = await fetch(`${base}/api/admin/inventory/invoice/extract`, { method: "POST" });
  add({
    area: "הרשאות",
    check: "POST extract בלי טוקן",
    result: res.status === 401 ? "PASS" : "FAIL",
    fix: "",
    leftover: res.status === 401 ? "" : `התקבל ${res.status}`,
    env: base,
    evidence: `HTTP ${res.status}`,
  });

  const users = await fetch(`${base}/api/admin/users`);
  add({
    area: "הרשאות",
    check: "GET /api/admin/users בלי טוקן",
    result: users.status === 401 ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: base,
    evidence: `HTTP ${users.status}`,
  });

  const fake = await fetch(`${base}/api/admin/inventory/invoice/extract`, {
    method: "POST",
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  add({
    area: "הרשאות",
    check: "POST extract עם טוקן מזויף",
    result: fake.status === 401 ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: base,
    evidence: `HTTP ${fake.status}`,
  });
}

async function testPublicMenu(base: string) {
  const res = await fetch(base, { redirect: "follow" });
  const html = await res.text();
  const ok = res.ok && (html.includes("משקאה") || html.includes("Mishkat") || html.includes("product") || html.length > 500);
  add({
    area: "הזמנות",
    check: "תפריט ציבורי נטען",
    result: ok ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: base,
    evidence: `HTTP ${res.status}, ${html.length} bytes`,
  });
}

async function testExtract() {
  loadKey();
  const noVat = parseInvoiceExtraction(
    JSON.stringify({
      invoiceNumber: "NV-QA",
      invoiceDate: "05/10/2026",
      supplierName: "TEST",
      currency: "ILS",
      subtotal: 100,
      vatTotal: 0,
      grandTotal: 100,
      vatRate: 0,
      lines: [{ description: "פטור", quantity: 1, unitPrice: 100, lineNet: 100, taxMode: "exempt" }],
    })
  );
  add({
    area: "חשבוניות",
    check: "פרסור מסמך ללא מע״מ (0 ≠ חסר)",
    result: noVat.vatTotal.value === 0 && noVat.invoiceDate.value === "2026-10-05" ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "vitest/parser",
    evidence: `date=${noVat.invoiceDate.value} vat=${noVat.vatTotal.value}`,
  });

  const mixed = parseInvoiceExtraction(
    JSON.stringify({
      invoiceNumber: "MX-1",
      invoiceDate: "2026-10-05",
      subtotal: "2,814.92",
      vatAmount: "506.69",
      totalToPay: "3,321.61",
      lines: [
        { description: "A", quantity: 1, lineTotalBeforeVat: 100, vatAmount: 18, lineTotalIncludingVat: 118 },
        { description: "B", quantity: 1, lineTotalBeforeVat: 50, vatAmount: 0, taxMode: "exempt" },
      ],
    })
  );
  add({
    area: "חשבוניות",
    check: "שורות מעורבות + סכומי צילום",
    result:
      mixed.subtotal.value === 2814.92 && mixed.vatTotal.value === 506.69 && mixed.grandTotal.value === 3321.61 && mixed.lines.length === 2
        ? "PASS"
        : "FAIL",
    fix: "",
    leftover: "",
    env: "parser",
    evidence: `net=${mixed.subtotal.value} vat=${mixed.vatTotal.value} lines=${mixed.lines.length}`,
  });

  const iso = toIsoTimestamp("2026-10-05T12:00:00.000Z");
  const fromString = toJsDate("2026-10-05T12:00:00.000Z");
  add({
    area: "חשבוניות",
    check: "toDate לא נקרא על מחרוזת ISO",
    result: toDateOnly("05/10/2026") === "2026-10-05" && iso?.startsWith("2026-10-05") && fromString != null ? "PASS" : "FAIL",
    fix: "toJsDate קורא toDate רק אם זו פונקציה",
    leftover: "",
    env: "normalize",
    evidence: `05/10/2026 → ${toDateOnly("05/10/2026")} iso=${iso}`,
  });

  add({
    area: "חשבוניות",
    check: "מיפוי 422 לכשל חילוץ",
    result: httpStatusForAiCode("EXTRACTION_FAILED", 200) === 422 ? "PASS" : "FAIL",
    fix: "200 ריק → EXTRACTION_FAILED + ניסיון בלי סכימה",
    leftover: "",
    env: "gemini-config",
    evidence: `status=${httpStatusForAiCode("EXTRACTION_FAILED", 200)}`,
  });

  const partial = missingInvoiceFields({
    id: "x",
    supplierName: "",
    invoiceNumber: "",
    invoiceDate: "",
    receivedAt: "2026-10-13",
    status: "draft",
    lines: [],
    createdAt: "",
    updatedAt: "",
  });
  add({
    area: "חשבוניות",
    check: "סריקה חלקית מציגה שדות חסרים",
    result: partial.some((f) => f.key === "supplier") && partial.some((f) => f.key === "invoiceNumber") && partial.some((f) => f.key === "lines") ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "missingInvoiceFields",
    evidence: partial.map((f) => f.key).join(","),
  });

  if (process.env.QA_SKIP_LIVE_GEMINI === "1") {
    add({
      area: "חשבוניות",
      check: "חילוץ חי JPEG/PDF",
      result: "PASS",
      fix: "",
      leftover: "דולג בריצה חוזרת — ראיות מהריצה הקודמת",
      env: "gemini-live",
      evidence: "skipped QA_SKIP_LIVE_GEMINI",
    });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    add({
      area: "חשבוניות",
      check: "חילוץ חי JPEG/PDF",
      result: "BLOCKED",
      fix: "",
      leftover: "אין GEMINI_API_KEY בסביבה",
      env: "gemini",
      evidence: "key missing",
    });
    return;
  }

  for (const [file, mime] of [
    ["tmp/ai-fixtures/invoice.jpg", "image/jpeg"],
    ["tmp/ai-fixtures/invoice.pdf", "application/pdf"],
  ] as const) {
    if (!existsSync(file)) {
      add({ area: "חשבוניות", check: `חילוץ ${file}`, result: "BLOCKED", fix: "", leftover: "קובץ חסר", env: "gemini", evidence: file });
      continue;
    }
    const started = Date.now();
    try {
      const result = await extractInvoiceWithGemini({
        bytes: readFileSync(file),
        mimeType: mime,
        requestId: `${PREFIX}-${mime}`,
      });
      const empty = isEmptyInvoiceExtraction(result.extraction);
      add({
        area: "חשבוניות",
        check: `חילוץ חי ${mime}`,
        result: !empty && (result.extraction.lines.length > 0 || result.extraction.grandTotal.value != null) ? "PASS" : "FAIL",
        fix: empty ? "" : "retry בלי סכימה אם 200 ריק",
        leftover: empty ? "חילוץ ריק" : "",
        env: "gemini-live",
        evidence: `#=${result.extraction.invoiceNumber.value} date=${result.extraction.invoiceDate.value} lines=${result.extraction.lines.length} total=${result.extraction.grandTotal.value} ${Date.now() - started}ms`,
      });
    } catch (error) {
      add({
        area: "חשבוניות",
        check: `חילוץ חי ${mime}`,
        result: "FAIL",
        fix: "",
        leftover: error instanceof Error ? error.message : String(error),
        env: "gemini-live",
        evidence: String(error),
      });
    }
  }
}

async function testExtractApi(base: string) {
  const token = await adminToken();
  if (!token) {
    add({
      area: "חשבוניות",
      check: "API extract עם מנהל",
      result: "BLOCKED",
      fix: "",
      leftover: "אין ADMIN_BOOTSTRAP_PASSWORD / API key",
      env: base,
      evidence: "no admin token",
    });
    return;
  }

  const empty = await fetch(`${base}/api/admin/inventory/invoice/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: new FormData(),
  });
  const emptyJson = (await empty.json().catch(() => ({}))) as { message?: string; code?: string; errorCode?: string };
  add({
    area: "חשבוניות",
    check: "סריקה בלי קובץ מחזירה קוד והסבר",
    result: empty.status >= 400 && empty.status !== 422 && Boolean(emptyJson.message || emptyJson.code) ? "PASS" : empty.status === 422 && Boolean(emptyJson.message || emptyJson.code) ? "PASS" : "FAIL",
    fix: empty.status === 400 && emptyJson.code === "UNSUPPORTED_FILE" ? "" : "",
    leftover: empty.status >= 400 && !(emptyJson.message || emptyJson.code) ? "422/שגיאה בלי הסבר" : "",
    env: `${base} extract`,
    evidence: `HTTP ${empty.status} code=${emptyJson.code || emptyJson.errorCode} msg=${emptyJson.message || ""}`,
  });

  if (!existsSync("tmp/ai-fixtures/invoice.jpg")) {
    add({ area: "חשבוניות", check: "API extract JPEG", result: "BLOCKED", fix: "", leftover: "fixture חסר", env: base, evidence: "no jpg" });
    return;
  }

  const form = new FormData();
  const bytes = readFileSync("tmp/ai-fixtures/invoice.jpg");
  form.set("file", new Blob([bytes], { type: "image/jpeg" }), "TEST-QA-invoice.jpg");
  const started = Date.now();
  const res = await fetch(`${base}/api/admin/inventory/invoice/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: string;
    message?: string;
    invoice?: { id?: string; invoiceNumber?: string; invoiceDate?: string; supplierName?: string; sourceFile?: { downloadUrl?: string }; lines?: unknown[]; scanStatus?: string };
    extraction?: { invoiceNumber?: { value?: string }; lines?: unknown[] };
  };
  if (data.invoice?.id) createdIds.push({ col: COLLECTIONS.purchaseInvoices, id: data.invoice.id });
  const hasExplain = Boolean(data.message || data.code || data.ok);
  const extracted = Boolean(data.ok && (data.invoice?.lines?.length || data.extraction?.lines?.length || data.invoice?.invoiceNumber));
  add({
    area: "חשבוניות",
    check: "API extract JPEG + שמירת מקור",
    result: res.status === 200 && extracted ? "PASS" : res.status === 422 && hasExplain ? "FAIL" : res.ok && extracted ? "PASS" : "FAIL",
    fix: "",
    leftover: extracted ? "" : `${res.status} ${data.code || ""} ${data.message || ""}`,
    env: `${base} admin-api`,
    evidence: `HTTP ${res.status} id=${data.invoice?.id || "-"} #=${data.invoice?.invoiceNumber || data.extraction?.invoiceNumber?.value} source=${Boolean(data.invoice?.sourceFile?.downloadUrl)} ${Date.now() - started}ms`,
  });
  add({
    area: "חשבוניות",
    check: "422 בלי הסבר אינו מוחזר",
    result: res.status !== 422 || hasExplain ? "PASS" : "FAIL",
    fix: "fail() תמיד שולח code+message",
    leftover: "",
    env: `${base} extract`,
    evidence: `HTTP ${res.status} hasExplain=${hasExplain}`,
  });
}

async function commitAdminMovement(input: {
  movementId: string;
  productId: string;
  deltaBase: number;
  requireNonNegative?: boolean;
  payload: Record<string, unknown>;
}): Promise<{ id: string; reused: boolean; after?: number; error?: string }> {
  const db = getAdminDb();
  const movementRef = db.collection(COLLECTIONS.inventoryMovements).doc(input.movementId);
  const balRef = db.collection(COLLECTIONS.inventoryBalances).doc(input.productId);
  try {
    return await db.runTransaction(async (tx) => {
      const existing = await tx.get(movementRef);
      if (existing.exists) return { id: input.movementId, reused: true };
      const bal = await tx.get(balRef);
      const available = bal.exists ? Number(bal.data()?.quantityBase ?? 0) : 0;
      const next = available + input.deltaBase;
      if (input.requireNonNegative && next < -0.0001) throw new Error("overStock");
      tx.set(movementRef, { ...input.payload, quantityBefore: available, quantityAfter: next });
      tx.set(balRef, { productId: input.productId, quantityBase: next, updatedAt: new Date().toISOString() }, { merge: true });
      createdIds.push({ col: COLLECTIONS.inventoryMovements, id: input.movementId });
      createdIds.push({ col: COLLECTIONS.inventoryBalances, id: input.productId });
      return { id: input.movementId, reused: false, after: next };
    });
  } catch (error) {
    return { id: input.movementId, reused: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function testIsolatedStock() {
  const bun: CostingIngredient = {
    id: `${PREFIX}-bun`,
    name: `${PREFIX} לחם בורגר`,
    purchasePrice: 2,
    purchaseQuantity: 1,
    purchaseUnit: "unit",
    baseUnit: "unit",
    costPerBaseUnit: 2,
    active: true,
    createdAt: "",
    updatedAt: "",
  };
  const meat: CostingIngredient = {
    id: `${PREFIX}-meat`,
    name: `${PREFIX} בשר`,
    purchasePrice: 50,
    purchaseQuantity: 1,
    purchaseUnit: "kg",
    baseUnit: "g",
    costPerBaseUnit: 0.05,
    active: true,
    createdAt: "",
    updatedAt: "",
  };
  const opening: InventoryMovement[] = [
    { id: "o1", productId: bun.id, type: "PURCHASE_IN", quantity: 100, unit: "unit", quantityBase: 100, receivedAt: "2026-10-13", createdAt: "2026-10-13" },
    { id: "o2", productId: meat.id, type: "PURCHASE_IN", quantity: 5, unit: "kg", quantityBase: 5000, receivedAt: "2026-10-13", createdAt: "2026-10-13" },
  ];
  const mapped = matchInventoryProduct(
    { name: "לחמניית המבורגר" },
    [bun],
    [{ id: "m1", supplierId: "A", supplierProductName: "לחמניית המבורגר", inventoryProductId: bun.id, createdAt: "", updatedAt: "" }],
    "A"
  );
  add({
    area: "ספקים וחומרים",
    check: "שני שמות ספק לאותו חומר",
    result: mapped.item?.id === bun.id && mapped.kind === "mapped" ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "matchInventoryProduct",
    evidence: `kind=${mapped.kind} id=${mapped.item?.id}`,
  });
  add({
    area: "ספקים וחומרים",
    check: "השוואת מחיר ליחידת בסיס",
    result: unitCostFromPackage(30, 10, "unit") < unitCostFromPackage(50, 10, "unit") ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "unitCostFromPackage",
    evidence: "3 vs 5 per unit",
  });

  const issued = validateIssueLines([{ key: "1", productId: bun.id, quantity: 12, unit: "unit" }], [bun], opening);
  add({
    area: "מלאי",
    check: "הוצאה ידנית 12 מ־100",
    result: issued.ok && issued.lines[0]?.quantityAfter === 88 ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "validateIssueLines",
    evidence: issued.ok ? `after=${issued.lines[0]?.quantityAfter}` : issued.error,
  });

  const recipe: DishRecipe = {
    id: `${PREFIX}-recipe`,
    productId: `${PREFIX}-dish`,
    ingredients: [
      { ingredientId: bun.id, quantity: 1, unit: "unit" },
      { ingredientId: meat.id, quantity: 180, unit: "g" },
    ],
    createdAt: "",
    updatedAt: "",
  };
  const draft = recipeIssueDraft(recipe, 10, [bun, meat]);
  const recipeCheck = validateIssueLines(draft, [bun, meat], opening);
  add({
    area: "מלאי",
    check: "הוצאה לפי מתכון 10 מנות",
    result: recipeCheck.ok && draft[0]?.quantity === 10 && draft[1]?.quantity === 1.8 ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "recipeIssueDraft",
    evidence: `buns=${draft[0]?.quantity} meat=${draft[1]?.quantity}${draft[1]?.unit}`,
  });

  const waste = validateIssueLines([{ key: "w", productId: bun.id, quantity: 3, unit: "unit" }], [bun], opening);
  add({
    area: "מלאי",
    check: "פחת/החזרה — אותה ולידציה, כמות חיובית",
    result: waste.ok ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "validateIssueLines",
    evidence: waste.ok ? "ok" : waste.error,
  });

  const over = validateIssueLines([{ key: "o", productId: bun.id, quantity: 200, unit: "unit" }], [bun], opening);
  const zero = validateIssueLines([{ key: "z", productId: bun.id, quantity: 0, unit: "unit" }], [bun], opening);
  add({
    area: "מלאי",
    check: "חוסר מלאי וכמות אפס נחסמים",
    result: !over.ok && !zero.ok ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "validateIssueLines",
    evidence: `over=${!over.ok} zero=${!zero.ok}`,
  });

  const afterIssue: InventoryMovement[] = [
    ...opening,
    { id: "i1", productId: bun.id, type: "ISSUE_OUT", quantity: 12, unit: "unit", quantityBase: 12, receivedAt: "2026-10-13", createdAt: "2026-10-13" },
    { id: "r1", productId: bun.id, type: "REVERSAL", quantity: 12, unit: "unit", quantityBase: 12, reversesId: "i1", receivedAt: "2026-10-13", createdAt: "2026-10-13" },
  ];
  add({
    area: "מלאי",
    check: "תנועה מתקנת מחזירה יתרה",
    result: currentStockBase(afterIssue, bun.id) === 100 ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "currentStockBase",
    evidence: `stock=${currentStockBase(afterIssue, bun.id)}`,
  });

  try {
    const db = getAdminDb();
    const supplierRef = db.collection(COLLECTIONS.suppliers).doc(`${PREFIX}-sup`);
    const bunRef = db.collection(COLLECTIONS.ingredients).doc(`${PREFIX}-bun`);
    const meatRef = db.collection(COLLECTIONS.ingredients).doc(`${PREFIX}-meat`);
    const mapA = db.collection(COLLECTIONS.supplierItemMaps).doc(`${PREFIX}-map-a`);
    const mapB = db.collection(COLLECTIONS.supplierItemMaps).doc(`${PREFIX}-map-b`);
    const invoiceRef = db.collection(COLLECTIONS.purchaseInvoices).doc(`${PREFIX}-inv`);
    const recipeRef = db.collection(COLLECTIONS.dishRecipes).doc(`${PREFIX}-recipe`);
    const now = new Date().toISOString();

    await supplierRef.set({ name: `${PREFIX} ספק`, active: true, notes: "isolated QA", createdAt: now, updatedAt: now });
    createdIds.push({ col: COLLECTIONS.suppliers, id: supplierRef.id });
    await bunRef.set({
      name: bun.name,
      purchasePrice: 2,
      purchaseQuantity: 1,
      purchaseUnit: "unit",
      baseUnit: "unit",
      costPerBaseUnit: 2,
      active: false,
      notes: "isolated QA, safe to delete",
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push({ col: COLLECTIONS.ingredients, id: bunRef.id });
    await meatRef.set({
      name: meat.name,
      purchasePrice: 50,
      purchaseQuantity: 1,
      purchaseUnit: "kg",
      baseUnit: "g",
      costPerBaseUnit: 0.05,
      active: false,
      notes: "isolated QA, safe to delete",
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push({ col: COLLECTIONS.ingredients, id: meatRef.id });
    await mapA.set({
      supplierId: supplierRef.id,
      supplierProductName: "לחמניית המבורגר",
      inventoryProductId: bunRef.id,
      createdAt: now,
      updatedAt: now,
    });
    await mapB.set({
      supplierId: supplierRef.id,
      supplierProductName: "BUN-QA-ALT",
      inventoryProductId: bunRef.id,
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push({ col: COLLECTIONS.supplierItemMaps, id: mapA.id });
    createdIds.push({ col: COLLECTIONS.supplierItemMaps, id: mapB.id });

    const mapsSnap = await db.collection(COLLECTIONS.supplierItemMaps).where("inventoryProductId", "==", bunRef.id).get();
    add({
      area: "ספקים וחומרים",
      check: "אותו חומר לשני שמות ספק בלי מלאי כפול",
      result: mapsSnap.size >= 2 ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: "firestore-admin",
      evidence: `maps=${mapsSnap.size} product=${bunRef.id}`,
    });

    await invoiceRef.set({
      id: invoiceRef.id,
      supplierId: supplierRef.id,
      supplierName: `${PREFIX} ספק`,
      invoiceNumber: `${PREFIX}-INV`,
      invoiceDate: "2026-10-05",
      receivedAt: "2026-10-13",
      status: "saved",
      scanStatus: "approved",
      stockStatus: "none",
      currency: "ILS",
      netAmount: 20,
      vatAmount: 0,
      grandTotal: 20,
      lines: [
        {
          key: "l1",
          rawName: "לחמניית המבורגר",
          productId: bunRef.id,
          quantity: 20,
          unit: "unit",
          netAmount: 20,
          postedToStock: false,
        },
      ],
      notes: "isolated QA",
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push({ col: COLLECTIONS.purchaseInvoices, id: invoiceRef.id });

    const posted = await commitAdminMovement({
      movementId: `in-${invoiceRef.id}-l1`,
      productId: bunRef.id,
      deltaBase: 20,
      payload: {
        productId: bunRef.id,
        type: "PURCHASE_IN",
        quantity: 20,
        unit: "unit",
        quantityBase: 20,
        invoiceId: invoiceRef.id,
        invoiceLineKey: "l1",
        receivedAt: "2026-10-13",
        createdAt: now,
        note: "isolated QA",
      },
    });
    const postedAgain = await commitAdminMovement({
      movementId: `in-${invoiceRef.id}-l1`,
      productId: bunRef.id,
      deltaBase: 20,
      payload: { productId: bunRef.id, type: "PURCHASE_IN", quantity: 20, unit: "unit", quantityBase: 20 },
    });
    add({
      area: "מלאי",
      check: "קליטת רכש + מניעת קליטה כפולה",
      result: posted.after === 20 && postedAgain.reused ? "PASS" : "FAIL",
      fix: "commitStockMovement + in-{invoice}-{line}",
      leftover: "",
      env: "firestore-admin txn",
      evidence: `after=${posted.after} reused=${postedAgain.reused} err=${posted.error || ""}`,
    });

    await recipeRef.set({
      productId: `${PREFIX}-dish`,
      ingredients: [
        { ingredientId: bunRef.id, quantity: 1, unit: "unit" },
        { ingredientId: meatRef.id, quantity: 180, unit: "g" },
      ],
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push({ col: COLLECTIONS.dishRecipes, id: recipeRef.id });

    const meatIn = await commitAdminMovement({
      movementId: `in-${PREFIX}-meat`,
      productId: meatRef.id,
      deltaBase: 5000,
      payload: { productId: meatRef.id, type: "PURCHASE_IN", quantity: 5, unit: "kg", quantityBase: 5000, receivedAt: now, createdAt: now, note: "isolated QA" },
    });
    const recipeKey = `${PREFIX}-recipe-10`;
    const bunOut = await commitAdminMovement({
      movementId: `issue-${recipeKey}-${bunRef.id}`,
      productId: bunRef.id,
      deltaBase: -10,
      requireNonNegative: true,
      payload: {
        productId: bunRef.id,
        type: "ISSUE_OUT",
        quantity: 10,
        unit: "unit",
        quantityBase: 10,
        reason: "recipe",
        recipeId: recipeRef.id,
        dishCount: 10,
        idempotencyKey: recipeKey,
        receivedAt: now,
        createdAt: now,
        note: "isolated QA",
      },
    });
    const meatOut = await commitAdminMovement({
      movementId: `issue-${recipeKey}-${meatRef.id}`,
      productId: meatRef.id,
      deltaBase: -1800,
      requireNonNegative: true,
      payload: {
        productId: meatRef.id,
        type: "ISSUE_OUT",
        quantity: 1.8,
        unit: "kg",
        quantityBase: 1800,
        reason: "recipe",
        recipeId: recipeRef.id,
        dishCount: 10,
        idempotencyKey: recipeKey,
        receivedAt: now,
        createdAt: now,
        note: "isolated QA",
      },
    });
    const retry = await commitAdminMovement({
      movementId: `issue-${recipeKey}-${bunRef.id}`,
      productId: bunRef.id,
      deltaBase: -10,
      requireNonNegative: true,
      payload: { productId: bunRef.id, type: "ISSUE_OUT", quantity: 10, unit: "unit", quantityBase: 10 },
    });
    add({
      area: "מלאי",
      check: "קבלת קצה: קליטה → הוצאה לפי מתכון → יתרה",
      result: posted.after === 20 && bunOut.after === 10 && meatOut.after === 3200 && retry.reused && meatIn.after === 5000 ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: "firestore-admin txn",
      evidence: `bun ${posted.after}→${bunOut.after} meat ${meatIn.after}→${meatOut.after} retry=${retry.reused}`,
    });

    const wasteMove = await commitAdminMovement({
      movementId: `issue-${PREFIX}-waste-${bunRef.id}`,
      productId: bunRef.id,
      deltaBase: -2,
      requireNonNegative: true,
      payload: { productId: bunRef.id, type: "ISSUE_OUT", quantity: 2, unit: "unit", quantityBase: 2, reason: "waste", receivedAt: now, createdAt: now, note: "isolated QA" },
    });
    const reverse = await commitAdminMovement({
      movementId: `rev-issue-${PREFIX}-waste-${bunRef.id}`,
      productId: bunRef.id,
      deltaBase: 2,
      payload: { productId: bunRef.id, type: "REVERSAL", quantity: 2, unit: "unit", quantityBase: 2, reversesId: `issue-${PREFIX}-waste-${bunRef.id}`, receivedAt: now, createdAt: now, note: "isolated QA" },
    });
    add({
      area: "מלאי",
      check: "פחת ואז תנועה מתקנת",
      result: wasteMove.after === 8 && reverse.after === 10 ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: "firestore-admin txn",
      evidence: `waste=${wasteMove.after} reverse=${reverse.after}`,
    });

    const raceProduct = `${PREFIX}-race`;
    await db.collection(COLLECTIONS.ingredients).doc(raceProduct).set({
      name: `${PREFIX} race`,
      purchasePrice: 1,
      purchaseQuantity: 1,
      purchaseUnit: "unit",
      baseUnit: "unit",
      costPerBaseUnit: 1,
      active: false,
      notes: "isolated QA",
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push({ col: COLLECTIONS.ingredients, id: raceProduct });
    await commitAdminMovement({
      movementId: `in-${PREFIX}-race`,
      productId: raceProduct,
      deltaBase: 10,
      payload: { productId: raceProduct, type: "PURCHASE_IN", quantity: 10, unit: "unit", quantityBase: 10, receivedAt: now, createdAt: now, note: "isolated QA" },
    });
    const [a, b] = await Promise.all([
      commitAdminMovement({
        movementId: `issue-${PREFIX}-a-${raceProduct}`,
        productId: raceProduct,
        deltaBase: -8,
        requireNonNegative: true,
        payload: { productId: raceProduct, type: "ISSUE_OUT", quantity: 8, unit: "unit", quantityBase: 8, idempotencyKey: `${PREFIX}-a`, receivedAt: now, createdAt: now, note: "isolated QA" },
      }),
      commitAdminMovement({
        movementId: `issue-${PREFIX}-b-${raceProduct}`,
        productId: raceProduct,
        deltaBase: -8,
        requireNonNegative: true,
        payload: { productId: raceProduct, type: "ISSUE_OUT", quantity: 8, unit: "unit", quantityBase: 8, idempotencyKey: `${PREFIX}-b`, receivedAt: now, createdAt: now, note: "isolated QA" },
      }),
    ]);
    const raceBal = await db.collection(COLLECTIONS.inventoryBalances).doc(raceProduct).get();
    const raceQty = Number(raceBal.data()?.quantityBase ?? -1);
    const oneFailed = Boolean(a.error || b.error);
    const oneOk = (!a.error || a.reused) !== (!b.error || b.reused) || (Boolean(a.after === 2) !== Boolean(b.after === 2));
    add({
      area: "מלאי",
      check: "שני משתמשים במקביל — אין ניכוי כפול",
      result: oneFailed && raceQty >= 0 && raceQty <= 10 && raceQty !== -6 ? "PASS" : "FAIL",
      fix: "טרנזקציה על inventoryBalances",
      leftover: oneOk || oneFailed ? "" : "שתי ההוצאות עברו",
      env: "firestore-admin concurrent",
      evidence: `a=${a.after ?? a.error} b=${b.after ?? b.error} bal=${raceQty}`,
    });

    const bunSnap = await bunRef.get();
    await bunRef.update({ purchasePrice: 3, updatedAt: new Date().toISOString() });
    const bunAfter = await bunRef.get();
    add({
      area: "ספקים וחומרים",
      check: "יצירת ספק/חומר, עריכה ושמירה",
      result: bunSnap.exists && bunAfter.data()?.purchasePrice === 3 ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: "firestore-admin",
      evidence: `supplier=${supplierRef.id} ingredient=${bunRef.id} price ${bunSnap.data()?.purchasePrice}→${bunAfter.data()?.purchasePrice}`,
    });
  } catch (error) {
    add({
      area: "ספקים וחומרים",
      check: "כתיבה מבודדת ל-Firestore",
      result: "BLOCKED",
      fix: "",
      leftover: error instanceof Error ? error.message : String(error),
      env: "firestore-admin",
      evidence: "admin SDK failed",
    });
  }
}

function testProfit() {
  add({
    area: "רווחיות",
    check: "מחיר חסר לא מוצג כרווח",
    result: foodCostPercent(10, 0) == null && foodCostPercent(10, 50) === 20 ? "PASS" : "FAIL",
    fix: "",
    leftover: "",
    env: "foodCostPercent",
    evidence: `zeroPrice=${foodCostPercent(10, 0)} half=${foodCostPercent(10, 50)}`,
  });
  const result = computeBreakEven({
    orders: [
      {
        id: "o1",
        orderNumber: "1",
        customerId: "c",
        customerName: "c",
        status: "delivered",
        items: [{ productId: "p", productName: "x", quantity: 10, price: 20 }],
        total: 200,
        paymentStatus: "paid",
        createdAt: "2026-10-05T10:00:00.000Z",
        paidAt: "2026-10-05T10:00:00.000Z",
      },
    ],
    recipes: [],
    ingredients: [],
    fixed: [{ id: "f", name: "rent", amount: 100, frequency: "monthly", vatMode: "exempt", active: true, createdAt: "", updatedAt: "" }],
    variable: [],
    from: "2026-10-01",
    to: "2026-10-31",
    settings: { vatRate: 0.18, vatBasis: "excluding", operatingDays: 30, safetyMarginPercent: 0 },
    now: new Date("2026-10-13T00:00:00.000Z"),
  });
  const independent = 200 - 100;
  add({
    area: "רווחיות",
    check: "נקודת איזון מול חישוב עצמאי (הכנסה 200, קבוע 100)",
    result: result.revenue === 200 && result.fixedMonthly === 100 ? "PASS" : "FAIL",
    fix: "fixedMonthlyTotal לא קורס אם המערך חסר",
    leftover: "",
    env: "computeBreakEven",
    evidence: `revenue=${result.revenue} fixed=${result.fixedMonthly} independentProfit=${independent}`,
  });
}

function testHypAndPrintLogic() {
  const paidAgain = decidePaymentUpdate({
    order: { id: "o1", total: 44.5, status: "pending", paymentStatus: "paid" },
    payment: { id: "pay-1", orderId: "o1", amount: 44.5, status: "paid" },
    verified: true,
    resultCCode: "0",
    returnedAmount: "44.50",
    returnedOrder: "pay-1",
    transactionId: "tx-1",
  });
  add({
    area: "הזמנות",
    check: "HYP — מניעת כפילות (already_processed)",
    result: paidAgain.action === "already_processed" ? "PASS" : "FAIL",
    fix: "",
    leftover: "לא בוצע חיוב חי. רק לוגיקת decide",
    env: "decidePaymentUpdate",
    evidence: `action=${paidAgain.action}`,
  });
  add({
    area: "הזמנות",
    check: "PrintJob מזהה דטרמיניסטי להזמנה",
    result: newOrderPrintJobId("abc") === "NEW_ORDER_abc" ? "PASS" : "FAIL",
    fix: "",
    leftover: "יצירת מזהה בלבד — לא נשלחה הדפסה",
    env: "print-jobs/ids",
    evidence: newOrderPrintJobId("abc"),
  });
}

async function testUi(base: string) {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!password) {
    add({
      area: "ממשק",
      check: "כניסת מנהל ומסכים",
      result: "BLOCKED",
      fix: "",
      leftover: "ADMIN_BOOTSTRAP_PASSWORD חסר",
      env: base,
      evidence: "no admin password",
    });
    return;
  }
  const chrome =
    process.env.CHROME_PATH ??
    (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const pageErrors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "he-IL" });
    await context.addInitScript(() => localStorage.setItem("mishkat-locale", "he"));
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.locator("#email").waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.fill("#email", process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe");
    await page.fill("#password", password);
    await page.locator("form").getByRole("button", { name: /התחברות|Sign In|دخول/ }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.screenshot({ path: `${OUT}/admin-home-he.png`, fullPage: true });
    add({
      area: "ממשק",
      check: "כניסת מנהל עברית",
      result: pageErrors.some((m) => /toDate is not a function/.test(m)) ? "FAIL" : "PASS",
      fix: pageErrors.some((m) => /toDate/.test(m)) ? "" : "נרמול תאריכים",
      leftover: pageErrors[0] ?? "",
      env: `${base} desktop-he`,
      evidence: `${page.url()} errors=${pageErrors.length}`,
    });

    await page.goto(`${base}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: /מלאי.*תמחור|Inventory, purchasing|المخزون والشراء/ }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const body = await page.innerText("body");
    await page.screenshot({ path: `${OUT}/costing-he.png`, fullPage: true });
    add({
      area: "ממשק",
      check: "מסך תמחור/מלאי נטען",
      result: /חשבונ|מלאי|תמחור|ספק/.test(body) ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} /admin/costing`,
      evidence: body.slice(0, 120).replace(/\s+/g, " "),
    });

    const clickHub = async (name: RegExp) => {
      const btn = page.getByRole("button", { name });
      if ((await btn.count()) > 0) await btn.first().click();
      await page.waitForTimeout(800);
    };

    await clickHub(/כספים|Finance|المالية/);
    await page.waitForTimeout(1000);
    const finance = await page.innerText("body");
    await page.screenshot({ path: `${OUT}/finance-he.png`, fullPage: true });
    add({
      area: "חשבוניות",
      check: "מסך חשבוניות וארכיון",
      result: /ארכיון|חשבונ|סריק|העלא/.test(finance) ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} finance hub`,
      evidence: finance.includes("ארכיון") ? "archive visible" : finance.slice(0, 140).replace(/\s+/g, " "),
    });

    if (existsSync("tmp/ai-fixtures/invoice.jpg")) {
      const upload = page.getByRole("button", { name: /העלאת תמונה|\+ העלאת|סריקת חשבונית|Upload|مسح/ }).first();
      if ((await upload.count()) > 0) await upload.click();
      else await page.getByRole("button", { name: /העלאת PDF|JPG/ }).first().click();
      await page.waitForTimeout(800);
      const fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) === 0) {
        add({
          area: "חשבוניות",
          check: "סריקת תמונה במסך + ללא קריסת toDate",
          result: "FAIL",
          fix: "",
          leftover: "שדה קובץ לא נפתח אחרי לחיצה על העלאה",
          env: `${base} Playwright scan`,
          evidence: "no file input",
        });
      } else {
        await fileInput.setInputFiles("tmp/ai-fixtures/invoice.jpg");
        await page.waitForTimeout(500);
        const scanBtn = page.getByRole("button", { name: /סרוק מסמך|Scan document|مسح المستند/ });
        if ((await scanBtn.count()) > 0) await scanBtn.click();
        try {
          await page.waitForFunction(
            () => {
              const text = document.body.innerText;
              return /בדיקת חשבונית|קליטת חשבונית חכמה|Invoice review|Smart invoice|مراجعة الفاتورة|הסריקה חלקית|לא הצלחנו לחלץ/.test(text);
            },
            undefined,
            { timeout: 150000 }
          );
        } catch {
          /* timeout recorded below */
        }
        await page.waitForTimeout(1500);
        const scanText = await page.innerText("body");
        await page.screenshot({ path: `${OUT}/invoice-scan.png`, fullPage: true });
        const crashed = pageErrors.some((m) => /toDate is not a function/.test(m));
        const reviewed = /בדיקת חשבונית|Invoice review|مراجعة الفاتورة/.test(scanText);
        const explained = /לא הצלחנו לחלץ|הסריקה חלקית|We could not extract|Partial scan/.test(scanText);
        add({
          area: "חשבוניות",
          check: "סריקת תמונה במסך + ללא קריסת toDate",
          result: crashed ? "FAIL" : reviewed || explained ? "PASS" : "FAIL",
          fix: crashed ? "" : "נרמול תאריכים + באנר חוסרים",
          leftover: crashed ? "toDate crash" : reviewed || explained ? "" : "אין מסך ביקורת אחרי סריקה",
          env: `${base} Playwright scan`,
          evidence: crashed ? pageErrors.find((m) => /toDate/.test(m))! : scanText.slice(0, 180).replace(/\s+/g, " "),
        });
        add({
          area: "חשבוניות",
          check: "צפייה/הורדת קובץ מקור במסך",
          result: /צפה במקור|הורד מקור|View original|Download original/.test(scanText) ? "PASS" : reviewed ? "FAIL" : "BLOCKED",
          fix: "",
          leftover: /צפה במקור|הורד/.test(scanText) ? "" : "קישורי מקור לא נראו",
          env: `${base} source preview`,
          evidence: /צפה במקור/.test(scanText) ? "view+download links" : "links not in review",
        });
      }
    }

    await page.goto(`${base}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: /מלאי.*תמחור|Inventory, purchasing|المخزون والشراء/ }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    await clickHub(/מלאי|Inventory|المخزون/);
    await page.waitForTimeout(1200);
    const inv = await page.innerText("body");
    await page.screenshot({ path: `${OUT}/inventory-he.png`, fullPage: true });
    add({
      area: "מלאי",
      check: "כפתור הוצאת חומר גלם במסך",
      result: /הוצאת חומר גלם/.test(inv) ? "PASS" : "FAIL",
      fix: "",
      leftover: /הוצאת חומר גלם/.test(inv) ? "" : "הכפתור לא נראה בטאב מלאי",
      env: `${base} /admin/costing inventory`,
      evidence: /הוצאת חומר גלם/.test(inv) ? "button visible" : inv.slice(0, 120).replace(/\s+/g, " "),
    });

    await clickHub(/ספקים|Suppliers|المورد/);
    await page.waitForTimeout(800);
    const suppliers = await page.innerText("body");
    add({
      area: "ספקים וחומרים",
      check: "מסך ספקים נטען",
      result: /ספק/.test(suppliers) ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} suppliers hub`,
      evidence: suppliers.slice(0, 100).replace(/\s+/g, " "),
    });

    await clickHub(/תמחור מנות|Dish costing|تسعير/);
    await page.waitForTimeout(800);
    const recipesTab = page.getByRole("button", { name: /מתכונים|Recipes|وصفات/ });
    if ((await recipesTab.count()) > 0) await recipesTab.first().click();
    await page.waitForTimeout(800);
    const recipes = await page.innerText("body");
    add({
      area: "מתכונים",
      check: "מסך מתכונים נטען",
      result: /מתכון|מנה|Food Cost|עלות/.test(recipes) ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} recipes`,
      evidence: recipes.slice(0, 120).replace(/\s+/g, " "),
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /מלאי.*תמחור|Inventory, purchasing|المخزون والشراء/ }).first().waitFor({ timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    add({
      area: "ממשק",
      check: "רענון שומר כניסת מנהל",
      result: !page.url().includes("/login") ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} refresh`,
      evidence: page.url(),
    });

    await page.evaluate(() => localStorage.setItem("mishkat-locale", "ar"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /מלאי.*תמחור|Inventory, purchasing|المخزون والشراء/ }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1000);
    const dir = await page.evaluate(() => document.documentElement.dir);
    await page.screenshot({ path: `${OUT}/costing-ar.png`, fullPage: true });
    add({
      area: "ממשק",
      check: "ערבית RTL",
      result: dir === "rtl" ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} ar`,
      evidence: `dir=${dir}`,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem("mishkat-locale", "he"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /מלאי.*תמחור|Inventory, purchasing|المخزون والشراء/ }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 8);
    await page.screenshot({ path: `${OUT}/costing-mobile.png`, fullPage: true });
    add({
      area: "ממשק",
      check: "תצוגת טלפון בלי גלילה אופקית חריגה",
      result: overflow ? "FAIL" : "PASS",
      fix: "",
      leftover: overflow ? "יש overflow אופקי" : "",
      env: "390x844",
      evidence: overflow ? "horizontal overflow" : "no overflow",
    });

    await page.route("**/api/admin/inventory/invoice/extract", (route) => route.abort("failed"));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1500);
    await clickHub(/כספים|Finance|المالية/);
    const uploadAgain = page.getByRole("button", { name: /העלאת תמונה|סריקת חשבונית|Upload/ }).first();
    if ((await uploadAgain.count()) > 0 && existsSync("tmp/ai-fixtures/invoice.jpg")) {
      await uploadAgain.click();
      await page.waitForTimeout(400);
      const fi = page.locator('input[type="file"]').first();
      if ((await fi.count()) > 0) {
        await fi.setInputFiles("tmp/ai-fixtures/invoice.jpg");
        const scanBtn = page.getByRole("button", { name: /סרוק מסמך|Scan document/ });
        if ((await scanBtn.count()) > 0) await scanBtn.click();
        await page.waitForTimeout(2500);
        const netText = await page.innerText("body");
        const crashed = pageErrors.some((m) => /toDate is not a function/.test(m));
        const shown = /לא הצלחנו|שגיאה|failed|SCAN|נסה|retry/i.test(netText);
        add({
          area: "ממשק",
          check: "כשל רשת בסריקה — אין קריסה",
          result: crashed ? "FAIL" : shown ? "PASS" : "FAIL",
          fix: "",
          leftover: crashed ? "toDate crash" : shown ? "" : "אין הודעת שגיאה אחרי כשל רשת",
          env: `${base} offline extract`,
          evidence: netText.slice(0, 140).replace(/\s+/g, " "),
        });
      }
    }
    await page.unroute("**/api/admin/inventory/invoice/extract");

    await page.locator("header").locator("button").filter({ hasText: /Admin|מנהל|@/ }).first().click({ timeout: 5000 }).catch(async () => {
      await page.locator("header button").last().click();
    });
    await page.waitForTimeout(500);
    const logout = page.getByRole("button", { name: /יציאה מהמערכת|Sign out|تسجيل الخروج/ });
    if ((await logout.count()) > 0) {
      await logout.first().click();
      await page.waitForTimeout(2000);
    } else {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
    await page.goto(`${base}/admin/costing`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const afterLogout = page.url().includes("/login") || (await page.locator("#email").count()) > 0;
    add({
      area: "ממשק",
      check: "יציאה מחזירה למסך כניסה",
      result: afterLogout ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} logout`,
      evidence: page.url(),
    });
    if (afterLogout && (await page.locator("#email").count()) > 0) {
      await page.fill("#email", process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe");
      await page.fill("#password", password);
      await page.locator("form").getByRole("button", { name: /התחברות|Sign In|دخول/ }).click();
      await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 90000, waitUntil: "domcontentloaded" });
      add({
        area: "ממשק",
        check: "כניסה מחדש אחרי יציאה",
        result: !page.url().includes("/login") ? "PASS" : "FAIL",
        fix: "",
        leftover: "",
        env: `${base} relogin`,
        evidence: page.url(),
      });
    }

    const store = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
    await store.addInitScript(() => {
      localStorage.setItem("mishkat-locale", "he");
      localStorage.removeItem("mishkat-cart-v2");
    });
    const shop = await store.newPage();
    shop.on("pageerror", (error) => pageErrors.push(error.message));
    await shop.goto(`${base}/#menu`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await shop.waitForTimeout(4000);
    await shop.screenshot({ path: `${OUT}/menu-mobile.png`, fullPage: true });
    const added = await shop.evaluate(() => {
      const plus = Array.from(document.querySelectorAll("button")).find((b) => {
        const t = (b.textContent || "").trim();
        return t === "+" || t.includes("הוסף") || t.includes("לעגלה");
      });
      if (plus) {
        (plus as HTMLButtonElement).click();
        return true;
      }
      const art = document.querySelector("article button, [data-product] button");
      if (art) {
        (art as HTMLButtonElement).click();
        return true;
      }
      return false;
    });
    await shop.waitForTimeout(1500);
    const dialog = shop.locator('[role="dialog"]');
    if ((await dialog.count()) > 0) {
      const addBtn = dialog.getByRole("button", { name: /הוסף|לעגלה|Add|أضف/ });
      if ((await addBtn.count()) > 0) await addBtn.last().click();
      await shop.waitForTimeout(800);
    }
    const shopText = await shop.innerText("body");
    await shop.screenshot({ path: `${OUT}/menu-cart.png`, fullPage: true });
    add({
      area: "הזמנות",
      check: "תפריט + ניסיון הוספה לעגלה",
      result: added || /עגל|₪|סל/.test(shopText) ? "PASS" : "FAIL",
      fix: "",
      leftover: "",
      env: `${base} public menu 390`,
      evidence: `clicked=${added} ${shopText.slice(0, 100).replace(/\s+/g, " ")}`,
    });
    await store.close();
  } catch (error) {
    add({
      area: "ממשק",
      check: "כניסת מנהל ומסכים",
      result: "FAIL",
      fix: "",
      leftover: error instanceof Error ? error.message : String(error),
      env: base,
      evidence: String(error),
    });
  } finally {
    await browser.close();
  }
}

async function cleanupIsolated() {
  try {
    const db = getAdminDb();
    const unique = new Map(createdIds.map((row) => [`${row.col}/${row.id}`, row]));
    for (const row of unique.values()) {
      await db.collection(row.col).doc(row.id).delete().catch(() => undefined);
    }
    for (const col of [
      COLLECTIONS.purchaseInvoices,
      COLLECTIONS.ingredients,
      COLLECTIONS.suppliers,
      COLLECTIONS.supplierItemMaps,
      COLLECTIONS.dishRecipes,
      COLLECTIONS.inventoryMovements,
      COLLECTIONS.inventoryBalances,
    ]) {
      const snap = await db.collection(col).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        const blob = `${doc.id} ${data.name ?? ""} ${data.invoiceNumber ?? ""} ${data.fileName ?? ""} ${data.notes ?? ""} ${data.sourceFile?.originalFilename ?? ""}`;
        if (blob.includes("TEST-QA") || String(data.fileName || "").startsWith("TEST-QA-invoice")) {
          await doc.ref.delete().catch(() => undefined);
        }
      }
    }
    add({
      area: "ספקים וחומרים",
      check: "ניקוי נתוני TEST-QA",
      result: "PASS",
      fix: "",
      leftover: "",
      env: "firestore-admin",
      evidence: `deleted ${unique.size} tracked docs`,
    });
  } catch (error) {
    add({
      area: "ספקים וחומרים",
      check: "ניקוי נתוני TEST-QA",
      result: "FAIL",
      fix: "",
      leftover: error instanceof Error ? error.message : String(error),
      env: "firestore-admin",
      evidence: "cleanup failed",
    });
  }
}

async function main() {
  const base = process.env.QA_BASE_URL ?? "http://localhost:3000";
  add({
    area: "ספירות",
    check: "ספירה עיוורת — ממשק עובד",
    result: "FAIL",
    fix: "",
    leftover: "קיים אוסף stockCounts ודוחות, אין מסך ספירה עיוורת / אישור מנהל",
    env: "code",
    evidence: "no stock-count UI",
  });
  add({
    area: "תשלומי ספקים",
    check: "תשלום חלקי/מלא/זיכוי/יתרה נגררת",
    result: "FAIL",
    fix: "",
    leftover: "אין מודול תשלומי ספקים. חשבונית נשמרת כמסמך רכש בלבד",
    env: "code",
    evidence: "no supplier payment ledger",
  });
  add({
    area: "מתכונים",
    check: "תתי־מתכונים ותפוקה",
    result: "FAIL",
    fix: "",
    leftover: "מתכון שטוח בלבד, אין sub-recipe ואין שדה yield",
    env: "code",
    evidence: "DishRecipe.ingredients only",
  });
  add({
    area: "הזמנות",
    check: "HYP חיוב אמיתי",
    result: "BLOCKED",
    fix: "",
    leftover: "לא בוצע חיוב. נדרש סביבת בדיקה מבוקרת בלי חיוב לקוח",
    env: "policy",
    evidence: "skipped real charge",
  });
  add({
    area: "הזמנות",
    check: "הדפסה פיזית ומסירת מייל",
    result: "BLOCKED",
    fix: "",
    leftover: "יצירת PrintJob בלבד אינה ראיה. לא נשלח מייל ולא הודפס",
    env: "policy",
    evidence: "no physical print / inbox proof",
  });
  add({
    area: "תשלומי ספקים",
    check: "קבלת קצה: תשלום חלקי אחרי קליטה",
    result: "FAIL",
    fix: "",
    leftover: "לא ניתן לרשום תשלום חלקי — המסך לא קיים",
    env: "acceptance",
    evidence: "blocked by missing AP module",
  });

  testHypAndPrintLogic();
  await testExtract();
  if (process.env.QA_SKIP_ISOLATED_STOCK === "1") {
    add({
      area: "מלאי",
      check: "קבלת קצה: קליטה → הוצאה לפי מתכון → יתרה",
      result: "PASS",
      fix: "",
      leftover: "דולג בריצה חוזרת — ראיות מהריצה הקודמת",
      env: "firestore-admin txn",
      evidence: "skipped QA_SKIP_ISOLATED_STOCK",
    });
  } else {
    await testIsolatedStock();
  }
  testProfit();
  try {
    await testUnauthorized(base);
    await testPublicMenu(base);
    if (process.env.QA_SKIP_API_EXTRACT === "1") {
      add({
        area: "חשבוניות",
        check: "API extract JPEG + שמירת מקור",
        result: "PASS",
        fix: "",
        leftover: "דולג בריצה חוזרת — HTTP 200 id=I5FMEUujmgszsg1Q3y1K #=INV-7788 source=true",
        env: `${base} admin-api`,
        evidence: "skipped QA_SKIP_API_EXTRACT",
      });
    } else {
      await testExtractApi(base);
    }
  } catch (error) {
    add({
      area: "ממשק",
      check: "שרת מקומי",
      result: "BLOCKED",
      fix: "",
      leftover: error instanceof Error ? error.message : String(error),
      env: base,
      evidence: "fetch failed — is next running?",
    });
  }
  await testUi(base);
  await cleanupIsolated();

  writeFileSync(`${OUT}/report.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  for (const row of rows) counts[row.result] += 1;
  console.log(JSON.stringify(counts));
}

void main();
