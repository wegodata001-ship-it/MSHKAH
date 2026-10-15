import { geminiGenerateJson } from "@/lib/ai/gemini-client";
import { toDateOnly } from "@/lib/dates/normalize";
import {
  buildZChecks,
  classifyPaymentRole,
  isEmptyZExtraction,
  isExtraZLabel,
  missingNotZero,
  zScanStatusFromExtract,
} from "@/lib/inventory/pos-z";
import type {
  PosZExtraAmount,
  PosZExtractedField,
  PosZFieldRole,
  PosZPayment,
  PosZReport,
} from "@/lib/inventory/types";

const PROMPT = `Extract an Israeli POS Z / X / end-of-day cash-register report from EVERY page and region. Return JSON only.

Read Hebrew, Arabic, English, and handwriting. Numbers may sit left of RTL labels.
Read labels such as: דוח Z, דוח X, דוח קופה, מספר דוח, קופה, קופאי, סניף, שם עסק,
תאריך, תקופה, מתאריך, עד תאריך, אשראי, אשראי ידני, סיכום אשראי, מזומן, כרטיס, ביט,
כמות עסקאות, מכירות לפני מע"מ, מע"מ, מע"מ 18%, סה"כ מכירות, סה"כ תקבולים,
החזרות, הנחות, דמי מחזור, מצטבר כללי.

Rules:
- Read only visible values. If a field is unreadable or absent, use null. Do not invent 0.
- Keep sourceLabel exactly as printed next to the value.
- periodFrom / periodTo is the header date range (example 01/10/2026–31/10/2026). Do not collapse the range to one day.
- printedAt is the datetime printed in the body (example 08/10/2026 14:30). Keep date and time. Do not treat it as the whole financial period.
- businessDate stays null unless a single business date is explicitly labeled as such. Never invent a daily split.
- payments[] is every tender and tender-summary line: method, sourceLabel, amount, count (transaction quantity if printed).
- אשראי and אשראי ידני are tenders (role=tender). סיכום אשראי is a summary of those tenders (role=tender-summary), not another payment method.
- extraAmounts[] holds printed amounts that are not period income or expense: דמי מחזור, מצטבר כללי, opening/closing accumulators. role=extra. Never add them to sales or receipts.
- salesBeforeVat, vatTotal, vatRate (18 or 0.18 if printed), salesIncludingVat / salesTotal, receiptsTotal, receiptsCount, returnsTotal, discountsTotal.
- salesTotal and receiptsTotal are two views of the same period, not two incomes.
- fields[] lists every labeled value found: sourceLabel + value, even if already mapped above.
- Do not guess missing cashiers, report numbers, registers, or amounts.

Dates as YYYY-MM-DD. Datetimes as YYYY-MM-DDTHH:mm:00. Numbers as JSON numbers (15892.5 not "15,892.50").`;

const PAYMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    method: { type: "STRING" },
    sourceLabel: { type: "STRING", nullable: true },
    amount: { type: "NUMBER", nullable: true },
    count: { type: "NUMBER", nullable: true },
    role: { type: "STRING", nullable: true },
  },
};

const FIELD_SCHEMA = {
  type: "OBJECT",
  properties: {
    key: { type: "STRING", nullable: true },
    sourceLabel: { type: "STRING" },
    value: { type: "STRING", nullable: true },
    kind: { type: "STRING", nullable: true },
    role: { type: "STRING", nullable: true },
    needsReview: { type: "BOOLEAN", nullable: true },
  },
};

const EXTRA_SCHEMA = {
  type: "OBJECT",
  properties: {
    sourceLabel: { type: "STRING" },
    amount: { type: "NUMBER", nullable: true },
    role: { type: "STRING", nullable: true },
  },
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    reportNumber: { type: "STRING", nullable: true },
    reportType: { type: "STRING", nullable: true },
    registerId: { type: "STRING", nullable: true },
    cashier: { type: "STRING", nullable: true },
    branch: { type: "STRING", nullable: true },
    businessName: { type: "STRING", nullable: true },
    businessDate: { type: "STRING", nullable: true },
    periodFrom: { type: "STRING", nullable: true },
    periodTo: { type: "STRING", nullable: true },
    printedAt: { type: "STRING", nullable: true },
    salesBeforeVat: { type: "NUMBER", nullable: true },
    salesTotal: { type: "NUMBER", nullable: true },
    salesIncludingVat: { type: "NUMBER", nullable: true },
    vatTotal: { type: "NUMBER", nullable: true },
    vatRate: { type: "NUMBER", nullable: true },
    receiptsTotal: { type: "NUMBER", nullable: true },
    receiptsCount: { type: "NUMBER", nullable: true },
    returnsTotal: { type: "NUMBER", nullable: true },
    discountsTotal: { type: "NUMBER", nullable: true },
    cashExpected: { type: "NUMBER", nullable: true },
    payments: { type: "ARRAY", items: PAYMENT_SCHEMA },
    extraAmounts: { type: "ARRAY", items: EXTRA_SCHEMA },
    fields: { type: "ARRAY", items: FIELD_SCHEMA },
  },
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[₪,\s]/g, "").replace(",", ".");
    if (!cleaned || cleaned === "—" || cleaned === "-") return null;
    const n = Number(cleaned);
    return missingNotZero(Number.isFinite(n) ? n : null);
  }
  const n = typeof value === "number" ? value : Number(value);
  return missingNotZero(Number.isFinite(n) ? n : null);
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

export function toPrintedDateTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  const dmyTime = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\s+(\d{1,2}):(\d{2})/);
  if (dmyTime) {
    const day = toDateOnly(`${dmyTime[1]}/${dmyTime[2]}/${dmyTime[3]}`);
    if (day) return `${day}T${String(dmyTime[4]).padStart(2, "0")}:${dmyTime[5]}:00`;
  }
  const isoTime = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})/);
  if (isoTime) return `${isoTime[1]}T${String(isoTime[2]).padStart(2, "0")}:${isoTime[3]}:00`;
  return toDateOnly(s);
}

function fieldRole(value: string | null | undefined, fallback: PosZFieldRole): PosZFieldRole {
  const n = (value ?? "").toLowerCase();
  if (n === "header" || n === "payment" || n === "payment-summary" || n === "sales" || n === "extra" || n === "other") {
    return n;
  }
  return fallback;
}

function fieldKind(value: string | null | undefined, fallback: PosZExtractedField["kind"]): PosZExtractedField["kind"] {
  if (value === "text" || value === "money" || value === "count" || value === "date" || value === "datetime") return value;
  return fallback;
}

function asField(
  key: string,
  sourceLabel: string,
  value: string | number | null,
  kind: PosZExtractedField["kind"],
  role: PosZFieldRole
): PosZExtractedField {
  return {
    key,
    sourceLabel,
    value,
    kind,
    role,
    needsReview: value == null || value === "",
  };
}

function parsePaymentRows(raw: unknown): { payments: PosZPayment[]; extras: PosZExtraAmount[] } {
  const payments: PosZPayment[] = [];
  const extras: PosZExtraAmount[] = [];
  if (!Array.isArray(raw)) return { payments, extras };
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const method = text(row.method) || text(row.sourceLabel);
    if (!method) continue;
    const sourceLabel = text(row.sourceLabel) || method;
    if (isExtraZLabel(sourceLabel) || row.role === "extra") {
      extras.push({ sourceLabel, amount: num(row.amount), role: "extra" });
      continue;
    }
    const role =
      row.role === "tender-summary" || row.role === "tender" ? row.role : classifyPaymentRole(sourceLabel);
    payments.push({
      method,
      sourceLabel,
      amount: num(row.amount),
      count: num(row.count),
      role,
    });
  }
  return { payments, extras };
}

function parseExtras(raw: unknown, fromPayments: PosZExtraAmount[]): PosZExtraAmount[] {
  const fromArray = Array.isArray(raw)
    ? raw
        .map((item): PosZExtraAmount | null => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const sourceLabel = text(row.sourceLabel) || text(row.method);
          if (!sourceLabel) return null;
          return { sourceLabel, amount: num(row.amount), role: "extra" };
        })
        .filter((item): item is PosZExtraAmount => Boolean(item))
    : [];
  const seen = new Set(fromArray.map((item) => item.sourceLabel));
  for (const extra of fromPayments) {
    if (!seen.has(extra.sourceLabel)) {
      fromArray.push(extra);
      seen.add(extra.sourceLabel);
    }
  }
  return fromArray;
}

function parseFields(raw: unknown): PosZExtractedField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index): PosZExtractedField | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const sourceLabel = text(row.sourceLabel) || text(row.key);
      if (!sourceLabel) return null;
      const kind = fieldKind(text(row.kind), typeof row.value === "number" ? "money" : "text");
      const value =
        kind === "money" || kind === "count" ? num(row.value) : text(row.value);
      return {
        key: text(row.key) || `field-${index}`,
        sourceLabel,
        value,
        kind,
        role: fieldRole(text(row.role), isExtraZLabel(sourceLabel) ? "extra" : "other"),
        needsReview: row.needsReview === true || value == null,
      };
    })
    .filter((item): item is PosZExtractedField => Boolean(item));
}

function synthesizedFields(report: Omit<PosZReport, "id" | "createdAt" | "status">): PosZExtractedField[] {
  const rows: PosZExtractedField[] = [
    asField("businessName", "שם עסק", report.businessName ?? null, "text", "header"),
    asField("reportType", "סוג דוח", report.reportType ?? null, "text", "header"),
    asField("reportNumber", "מספר דוח", report.reportNumber ?? null, "text", "header"),
    asField("registerId", "קופה", report.registerId ?? null, "text", "header"),
    asField("cashier", "קופאי", report.cashier ?? null, "text", "header"),
    asField("periodFrom", "מתאריך", report.periodFrom ?? null, "date", "header"),
    asField("periodTo", "עד תאריך", report.periodTo ?? null, "date", "header"),
    asField("printedAt", "מודפס בדוח", report.printedAt ?? null, "datetime", "header"),
    asField("salesBeforeVat", "מכירות לפני מע״מ", report.salesBeforeVat ?? null, "money", "sales"),
    asField("vatTotal", "מע״מ", report.vatTotal ?? null, "money", "sales"),
    asField("salesIncludingVat", "סה״כ מכירות", report.salesIncludingVat ?? report.salesTotal ?? null, "money", "sales"),
    asField("receiptsTotal", "סה״כ תקבולים", report.receiptsTotal ?? null, "money", "sales"),
    asField("receiptsCount", "כמות תקבולים", report.receiptsCount ?? null, "count", "sales"),
    asField("returnsTotal", "החזרות", report.returnsTotal ?? null, "money", "sales"),
    asField("discountsTotal", "הנחות", report.discountsTotal ?? null, "money", "sales"),
  ];
  (report.payments ?? []).forEach((payment, index) => {
    rows.push(
      asField(
        `payment-${index}`,
        payment.sourceLabel || payment.method,
        payment.amount,
        "money",
        payment.role === "tender-summary" ? "payment-summary" : "payment"
      )
    );
    if (payment.count != null) {
      rows.push(
        asField(
          `payment-count-${index}`,
          `${payment.sourceLabel || payment.method} · כמות`,
          payment.count,
          "count",
          payment.role === "tender-summary" ? "payment-summary" : "payment"
        )
      );
    }
  });
  (report.extraAmounts ?? []).forEach((extra, index) => {
    rows.push(asField(`extra-${index}`, extra.sourceLabel, extra.amount, "money", "extra"));
  });
  return rows;
}

function mergeFields(fromAi: PosZExtractedField[], synthesized: PosZExtractedField[]): PosZExtractedField[] {
  const byKey = new Map<string, PosZExtractedField>();
  for (const field of synthesized) byKey.set(field.key, field);
  for (const field of fromAi) {
    const existing = byKey.get(field.key);
    if (!existing || (existing.value == null && field.value != null)) byKey.set(field.key, field);
  }
  return [...byKey.values()];
}

export function parseZExtraction(raw: unknown): Omit<PosZReport, "id" | "createdAt" | "status"> {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsedRows = parsePaymentRows(data.payments);
  const payments = parsedRows.payments;
  const extraAmounts = parseExtras(data.extraAmounts, parsedRows.extras);
  const salesIncluding = num(data.salesIncludingVat) ?? num(data.salesTotal);
  const salesTotal = num(data.salesTotal) ?? salesIncluding;
  const parsed: Omit<PosZReport, "id" | "createdAt" | "status"> = {
    reportNumber: text(data.reportNumber),
    reportType: text(data.reportType),
    registerId: text(data.registerId),
    cashier: text(data.cashier),
    branch: text(data.branch),
    businessName: text(data.businessName),
    businessDate: toDateOnly(String(data.businessDate ?? "")) || null,
    periodFrom: toDateOnly(String(data.periodFrom ?? "")) || null,
    periodTo: toDateOnly(String(data.periodTo ?? "")) || null,
    printedAt: toPrintedDateTime(data.printedAt),
    salesBeforeVat: num(data.salesBeforeVat),
    salesTotal,
    salesIncludingVat: salesIncluding,
    vatTotal: num(data.vatTotal),
    vatRate: num(data.vatRate),
    receiptsTotal: num(data.receiptsTotal),
    receiptsCount: num(data.receiptsCount),
    returnsTotal: num(data.returnsTotal),
    discountsTotal: num(data.discountsTotal),
    cashExpected: num(data.cashExpected) ?? findCashAmount(payments),
    payments,
    extraAmounts,
    fields: [],
    checks: [],
    periodConfirmed: false,
    lastScanError: null,
  };
  parsed.fields = mergeFields(parseFields(data.fields), synthesizedFields(parsed));
  parsed.checks = buildZChecks(parsed);
  parsed.scanStatus = zScanStatusFromExtract({ ...parsed, id: "", createdAt: "", status: "draft" });
  if (isEmptyZExtraction(parsed)) parsed.scanStatus = "failed";
  return parsed;
}

function findCashAmount(payments: PosZPayment[]): number | null {
  const cash = payments.find((row) => /מזומן|cash/.test((row.sourceLabel || row.method).toLowerCase()));
  return cash?.amount ?? null;
}

export async function extractZReportWithGemini(input: {
  bytes?: Buffer;
  mimeType?: string;
  attachments?: { bytes: Buffer; mimeType: string }[];
  requestId?: string;
}): Promise<{ report: ReturnType<typeof parseZExtraction>; model: string; rawText: string }> {
  const attachments =
    input.attachments?.length
      ? input.attachments
      : input.bytes && input.mimeType
        ? [{ bytes: input.bytes, mimeType: input.mimeType }]
        : [];
  const parts: unknown[] = [
    { text: PROMPT },
    ...attachments.map((file) => ({
      inlineData: {
        mimeType: file.mimeType,
        data: file.bytes.toString("base64"),
      },
    })),
  ];
  const result = await geminiGenerateJson({
    parts,
    schema: SCHEMA,
    requestId: input.requestId,
  });
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(result.text);
  } catch {
    parsed = {};
  }
  return { report: parseZExtraction(parsed), model: result.model, rawText: result.text };
}
