import { formatIls, roundMoney } from "@/lib/costing/money";
import type { PurchaseUnit } from "@/lib/costing/types";
import { headerGross, headerNet, headerVat } from "@/lib/inventory/invoice-finance";
import { measureUnitLabel } from "@/lib/inventory/measure-units";
import type {
  InventoryMovement,
  InvoiceAuditEvent,
  PurchaseInvoice,
  PurchaseInvoiceLine,
} from "@/lib/inventory/types";

export const INVOICE_DOCUMENT_TITLE = "משקאת — תיעוד חשבונית רכש";
export const SYSTEM_DOCUMENT_MARK = "מסמך מערכת — אינו החשבונית המקורית";
export const NOT_POSTED_LABEL = "טרם נקלט למלאי";

const UNIT_LABELS: Record<string, string> = {
  kg: "ק״ג",
  g: "גרם",
  liter: "ליטר",
  ml: "מ״ל",
  unit: "יחידה",
  bucket: "דלי",
  pack: "חבילה",
  carton: "קרטון",
  bottle: "בקבוק",
  bag: "שק",
  bundle: "צרור",
  tray: "מגש",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "חשבונית",
  tax_invoice: "חשבונית מס",
  receipt: "קבלה",
  tax_receipt: "חשבונית מס קבלה",
  delivery: "תעודת משלוח",
  credit: "זיכוי",
  other: "מסמך אחר",
};

const VAT_MODE_LABELS: Record<string, string> = {
  inclusive: "כולל מע״מ",
  exclusive: "לפני מע״מ",
  exempt: "פטור",
  unknown: "לא צוין",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה",
  needs_review: "בבדיקה",
  saved: "נשמרה",
  approving: "באישור",
  approved: "אושרה",
  rejected: "נדחתה",
  cancelled: "בוטלה",
  uploaded: "הועלתה",
  scanning: "בסריקה",
  ready: "מוכנה",
  posted: "נקלטה",
  failed: "נכשלה",
};

export type InvoiceDocumentLine = {
  position: number;
  name: string;
  category: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  vat: string;
  total: string;
  product: string;
  receipt: "נקלט" | "ממתין" | "נכשל";
};

export type InvoiceTimelineEvent = {
  at: string;
  actor: string;
  action: string;
  detail?: string;
  before?: string;
  after?: string;
};

export type InvoiceDocument = {
  title: string;
  systemDocument: true;
  systemMark: string;
  generatedAt: string;
  header: { label: string; value: string }[];
  lines: InvoiceDocumentLine[];
  money: { label: string; value: string }[];
  mismatchNote: string | null;
  stock: {
    posted: boolean;
    emptyLabel: string | null;
    facts: { label: string; value: string }[];
    movements: { label: string; value: string }[];
    issues: string[];
  };
  timeline: InvoiceTimelineEvent[];
  source: {
    available: boolean;
    kind: "pdf" | "image" | "other" | "none";
    filename: string | null;
    note: string;
  };
  notes: string[];
};

export type InvoiceDocumentContext = {
  invoice: PurchaseInvoice;
  movements?: InventoryMovement[];
  paidAmount?: number | null;
  paymentsIncluded?: boolean;
  productNames?: Record<string, string>;
  generatedAt?: string;
};

function text(value: unknown, fallback = "—"): string {
  if (value == null) return fallback;
  const raw = String(value).trim();
  return raw || fallback;
}

function moneyOrMissing(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "לא נשמר";
  return formatIls(value);
}

export function unitDocumentLabel(unit: PurchaseUnit | string | null | undefined): string {
  if (!unit) return "—";
  return UNIT_LABELS[unit] ?? measureUnitLabel(unit) ?? String(unit);
}

export function formatVatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "לא נשמר";
  const percent = rate > 1 ? rate : rate * 100;
  const rounded = roundMoney(percent, Number.isInteger(percent) ? 0 : 2);
  return `${rounded}%`;
}

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceKind(invoice: PurchaseInvoice): InvoiceDocument["source"]["kind"] {
  const kind = invoice.sourceFile?.kind;
  const mime = invoice.sourceFile?.mimeType || "";
  const name = invoice.sourceFile?.originalFilename || invoice.fileName || "";
  if (kind === "pdf" || mime.includes("pdf") || name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (kind === "jpg" || kind === "png" || kind === "camera" || mime.startsWith("image/")) return "image";
  if (invoice.sourceFile?.storagePath) return "other";
  return "none";
}

function receiptState(line: PurchaseInvoiceLine): InvoiceDocumentLine["receipt"] {
  if (line.postedToStock) return "נקלט";
  const marker = `${line.note ?? ""} ${line.rowStatus ?? ""}`.toLowerCase();
  if (marker.includes("failed") || marker.includes("נכשל")) return "נכשל";
  return "ממתין";
}

function lineVatLabel(line: PurchaseInvoiceLine): string {
  const rate = formatVatRate(line.vatRate);
  const amount = line.vatAmount == null ? "לא נשמר" : formatIls(line.vatAmount);
  const mode = line.vatType || line.vatMode || line.taxMode;
  const modeLabel = mode ? VAT_MODE_LABELS[mode] ?? mode : "לא נשמר";
  return `${modeLabel} · ${rate} · ${amount}`;
}

function lineTotal(line: PurchaseInvoiceLine): number | null {
  const value = line.lineTotal ?? line.grossAmount ?? line.lineGross ?? line.netAmount ?? line.lineNet ?? null;
  return value == null || !Number.isFinite(value) ? null : value;
}

function discountLabel(line: PurchaseInvoiceLine): string {
  if (line.discountAmount != null) return formatIls(line.discountAmount);
  if (line.discount != null) return formatIls(line.discount);
  if (line.discountPercent != null) return `${line.discountPercent}%`;
  return "—";
}

function headerDiscountAmount(invoice: PurchaseInvoice): number | null {
  if (invoice.discountTotal != null && Number.isFinite(invoice.discountTotal)) return invoice.discountTotal;
  if (invoice.headerDiscount != null && Number.isFinite(invoice.headerDiscount)) return invoice.headerDiscount;
  const lineDiscounts = invoice.lines
    .map((line) => line.discountAmount ?? line.discount)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!lineDiscounts.length) return null;
  return roundMoney(lineDiscounts.reduce((sum, value) => sum + value, 0));
}

function productLabel(line: PurchaseInvoiceLine, names: Record<string, string>): string {
  if (line.productId && names[line.productId]) return names[line.productId];
  if (line.plannedProductName?.trim()) return line.plannedProductName.trim();
  if (line.productId) return line.productId;
  return "לא שויך";
}

function pushEvent(events: InvoiceTimelineEvent[], event: InvoiceTimelineEvent | null) {
  if (!event?.at) return;
  events.push(event);
}

function timelineFrom(invoice: PurchaseInvoice): InvoiceTimelineEvent[] {
  const events: InvoiceTimelineEvent[] = [];
  pushEvent(events, invoice.createdAt ? { at: invoice.createdAt, actor: text(invoice.createdBy, "לא נשמר"), action: "יצירת החשבונית" } : null);
  const uploadedAt = invoice.sourceFile?.uploadedAt || invoice.uploadedAt;
  if (uploadedAt) {
    pushEvent(events, {
      at: uploadedAt,
      actor: text(invoice.sourceFile?.uploadedBy ?? invoice.createdBy, "לא נשמר"),
      action: "העלאת קובץ המקור",
      detail: invoice.sourceFile?.originalFilename,
    });
  }
  for (const attempt of invoice.scanAttempts ?? []) {
    if (!attempt.timestamp) continue;
    pushEvent(events, {
      at: attempt.timestamp,
      actor: text(attempt.provider, "לא נשמר"),
      action: attempt.status === "ok" ? "סריקת AI" : "סריקת AI נכשלה",
      detail: attempt.code || attempt.model,
    });
  }
  for (const audit of invoice.audit ?? []) {
    pushEvent(events, auditEvent(audit));
  }
  if (invoice.approvedAt) {
    pushEvent(events, { at: invoice.approvedAt, actor: text(invoice.approvedBy, "לא נשמר"), action: "אישור חשבונית" });
  }
  if (invoice.inventoryPostedAt) {
    pushEvent(events, { at: invoice.inventoryPostedAt, actor: text(invoice.inventoryPostedBy, "לא נשמר"), action: "קליטה למלאי" });
  }
  if (invoice.cancelledAt) {
    pushEvent(events, {
      at: invoice.cancelledAt,
      actor: text(invoice.cancelledBy, "לא נשמר"),
      action: "ביטול",
      detail: invoice.cancelReason,
    });
  }
  if (invoice.archivedAt) {
    pushEvent(events, {
      at: invoice.archivedAt,
      actor: text(invoice.archivedBy, "לא נשמר"),
      action: "העברה לארכיון",
      detail: invoice.archiveReason,
    });
  }
  const seen = new Set<string>();
  return events
    .filter((event) => {
      const key = `${event.at}|${event.action}|${event.detail ?? ""}|${event.before ?? ""}|${event.after ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

function auditEvent(audit: InvoiceAuditEvent): InvoiceTimelineEvent | null {
  if (!audit.at || !audit.action) return null;
  return {
    at: audit.at,
    actor: text(audit.actor, "לא נשמר"),
    action: audit.action,
    detail: audit.detail,
    before: audit.before,
    after: audit.after,
  };
}

function movementMatchesLine(movement: InventoryMovement, line: PurchaseInvoiceLine): boolean {
  return movement.invoiceLineKey === line.key || movement.invoiceLineId === line.key;
}

export function buildInvoiceDocument(input: InvoiceDocumentContext): InvoiceDocument {
  const invoice = input.invoice;
  const movements = (input.movements ?? []).filter((movement) => !movement.invoiceId || movement.invoiceId === invoice.id);
  const names = input.productNames ?? {};
  const net = headerNet(invoice);
  const vat = headerVat(invoice);
  const gross = headerGross(invoice);
  const mismatch = storedHeaderMismatch(invoice);
  const kind = sourceKind(invoice);
  const paid = input.paymentsIncluded ? input.paidAmount ?? 0 : input.paidAmount ?? null;
  const balance = gross != null && paid != null ? roundMoney(gross - paid) : null;
  const posted = invoice.stockStatus === "posted" || Boolean(invoice.inventoryPostedAt);
  const issues = stockIssues(invoice, movements);

  const lines = invoice.lines.map((line, index) => ({
    position: index + 1,
    name: line.rawName?.trim() || line.originalDescription?.trim() || "—",
    category: text(line.category),
    quantity: line.quantity == null ? "—" : String(line.quantity),
    unit: unitDocumentLabel(line.unit),
    unitPrice: moneyOrMissing(line.unitPrice),
    discount: discountLabel(line),
    vat: lineVatLabel(line),
    total: moneyOrMissing(lineTotal(line)),
    product: productLabel(line, names),
    receipt: receiptState(line),
  }));

  return {
    title: INVOICE_DOCUMENT_TITLE,
    systemDocument: true,
    systemMark: SYSTEM_DOCUMENT_MARK,
    generatedAt: input.generatedAt || new Date().toISOString(),
    header: [
      { label: "מספר חשבונית", value: text(invoice.invoiceNumber) },
      { label: "סוג מסמך", value: DOC_TYPE_LABELS[invoice.documentType || "invoice"] ?? text(invoice.documentType) },
      { label: "שם ספק", value: text(invoice.supplierName) },
      { label: "מספר עוסק / ח.פ.", value: text(invoice.supplierTaxId || invoice.supplierVatNumber, "לא נשמר") },
      { label: "תאריך חשבונית", value: text(invoice.invoiceDate) },
      { label: "תאריך קליטה", value: formatWhen(invoice.receivedAt || invoice.createdAt) },
      { label: "תאריך פירעון", value: text(invoice.dueDate, "לא נשמר") },
      { label: "סטטוס בדיקה", value: STATUS_LABELS[invoice.scanStatus || invoice.status] ?? text(invoice.status) },
      { label: "סטטוס קליטה למלאי", value: posted ? "נקלט למלאי" : invoice.stockStatus === "partial" ? "קליטה חלקית" : NOT_POSTED_LABEL },
      { label: "מזהה פנימי", value: invoice.id },
      { label: "הוזן על ידי", value: text(invoice.createdBy, "לא נשמר") },
    ],
    lines,
    money: [
      { label: "סכום לפני הנחה", value: moneyOrMissing(invoice.subtotalBeforeDiscount) },
      { label: "סך הנחות", value: moneyOrMissing(headerDiscountAmount(invoice)) },
      { label: "סכום לפני מע״מ", value: moneyOrMissing(net) },
      { label: "סכום מע״מ", value: moneyOrMissing(vat) },
      { label: "שיעור מע״מ במסמך", value: formatVatRate(invoice.vatRate) },
      { label: "סוג מע״מ במסמך", value: invoice.vatMode ? VAT_MODE_LABELS[invoice.vatMode] ?? invoice.vatMode : "לא נשמר" },
      { label: "סכום כולל מע״מ", value: moneyOrMissing(gross) },
      { label: "סכום מסמך המקור", value: moneyOrMissing(invoice.originalInvoiceTotal ?? invoice.invoiceTotalFromSource ?? invoice.sourceGross ?? gross) },
      { label: "סכום שתוקן ידנית", value: invoice.manuallyEdited ? moneyOrMissing(invoice.editedInvoiceTotal) : "לא תוקן" },
      { label: "סכום ששולם", value: paid == null ? "לא נשמר" : formatIls(paid) },
      { label: "יתרה לתשלום", value: balance == null ? "לא נשמר" : formatIls(balance) },
    ],
    mismatchNote: mismatch.hasMismatch
      ? `אי־התאמה בין סכומי השורות לסכומים השמורים. לפני מע״מ ${moneyOrMissing(mismatch.netDiff)} · מע״מ ${moneyOrMissing(mismatch.vatDiff)} · כולל ${moneyOrMissing(mismatch.grossDiff)}`
      : null,
    stock: {
      posted,
      emptyLabel: posted || movements.length ? null : NOT_POSTED_LABEL,
      facts: [
        { label: "נקלט למלאי", value: posted ? "כן" : "לא" },
        { label: "תאריך קליטה", value: invoice.inventoryPostedAt ? formatWhen(invoice.inventoryPostedAt) : "לא נשמר" },
        { label: "אישר את הקליטה", value: text(invoice.inventoryPostedBy, "לא נשמר") },
      ],
      movements: movements.map((movement) => {
        const line = invoice.lines.find((item) => movementMatchesLine(movement, item));
        const purchase = line ? `${line.quantity ?? "—"} ${unitDocumentLabel(line.unit)}` : "—";
        const name = (movement.productId && names[movement.productId]) || line?.rawName || movement.productId || "—";
        return {
          label: name,
          value: `${movement.type} · רכישה ${purchase} · בפועל ${movement.quantity} ${unitDocumentLabel(movement.unit)} · בסיס ${movement.quantityBase}`,
        };
      }),
      issues,
    },
    timeline: timelineFrom(invoice),
    source: {
      available: kind !== "none",
      kind,
      filename: invoice.sourceFile?.originalFilename || invoice.fileName || null,
      note: kind === "none"
        ? "קובץ המקור אינו זמין."
        : kind === "pdf"
          ? "קובץ המקור הוא PDF. עמודיו מצורפים כנספח כאשר הקובץ נקרא בהצלחה."
          : kind === "image"
            ? "קובץ המקור הוא תמונה. הוא מוצג בנפרד, והמסמך הזה הוא תיעוד מערכת."
            : "קובץ מקור שמור, אך סוגו אינו PDF או תמונה.",
    },
    notes: documentNotes(invoice, mismatch.hasMismatch),
  };
}

function storedHeaderMismatch(invoice: PurchaseInvoice): { hasMismatch: boolean; netDiff: number | null; vatDiff: number | null; grossDiff: number | null } {
  const header = { net: headerNet(invoice), vat: headerVat(invoice), gross: headerGross(invoice) };
  let net = 0;
  let vat = 0;
  let gross = 0;
  let sawNet = false;
  let sawVat = false;
  let sawGross = false;
  for (const line of invoice.lines) {
    const lineNet = line.netAmount ?? line.lineNet ?? line.priceBeforeVat;
    const lineVat = line.vatAmount;
    const lineGross = line.grossAmount ?? line.lineGross ?? line.priceIncludingVat ?? line.lineTotal;
    if (lineNet != null && Number.isFinite(lineNet)) { net += lineNet; sawNet = true; }
    if (lineVat != null && Number.isFinite(lineVat)) { vat += lineVat; sawVat = true; }
    if (lineGross != null && Number.isFinite(lineGross)) { gross += lineGross; sawGross = true; }
  }
  const diff = (sum: number, seen: boolean, value: number | null) => !seen || value == null ? null : roundMoney(sum - value);
  const netDiff = diff(net, sawNet, header.net);
  const vatDiff = diff(vat, sawVat, header.vat);
  const grossDiff = diff(gross, sawGross, header.gross);
  const off = (value: number | null) => value != null && Math.abs(value) > 0.05;
  return { hasMismatch: off(netDiff) || off(vatDiff) || off(grossDiff), netDiff, vatDiff, grossDiff };
}

function stockIssues(invoice: PurchaseInvoice, movements: InventoryMovement[]): string[] {
  const issues: string[] = [];
  if (invoice.validation?.hasMismatch) issues.push("נשמרה אי־התאמה בין סכומי הסריקה לסכומי המסמך.");
  const review = invoice.lines.filter((line) => line.needsReview).map((line) => line.rawName).filter(Boolean);
  if (review.length) issues.push(`שורות שסומנו לבדיקה: ${review.join(" · ")}`);
  const failedScans = (invoice.scanAttempts ?? []).filter((attempt) => attempt.status === "failed" && attempt.code);
  for (const attempt of failedScans) issues.push(`סריקה נכשלה: ${attempt.code}`);
  if (invoice.stockStatus === "partial") issues.push("הקליטה למלאי חלקית לפי הסטטוס השמור.");
  if (!movements.length && (invoice.stockStatus === "posted" || invoice.inventoryPostedAt)) {
    issues.push("החשבונית מסומנת כנקלטה, אך לא נמצאו תנועות מלאי מקושרות.");
  }
  return issues;
}

function documentNotes(invoice: PurchaseInvoice, mismatch: boolean): string[] {
  const notes: string[] = [];
  if (invoice.notes?.trim()) notes.push(`הערות: ${invoice.notes.trim()}`);
  for (const line of invoice.lines) {
    if (line.note?.trim()) notes.push(`${line.rawName || "שורה"}: ${line.note.trim()}`);
  }
  if (invoice.cancelReason?.trim()) notes.push(`סיבת ביטול: ${invoice.cancelReason.trim()}`);
  if (mismatch) notes.push("קיימת אי־התאמה בין סכומי השורות לסכומים השמורים בכותרת.");
  const manual = (invoice.audit ?? []).filter((event) => event.action && event.before && event.after);
  if (manual.length) {
    notes.push(`תיקונים ידניים שמורים: ${manual.length}`);
  } else {
    notes.push("אין תיקונים ידניים עם ערך קודם וחדש בשמירת המסמך.");
  }
  if (!notes.length) notes.push("אין הערות שמורות.");
  return notes;
}

export type InvoicePageBlock =
  | { kind: "banner" }
  | { kind: "header" }
  | { kind: "lines"; rows: InvoiceDocumentLine[] }
  | { kind: "money" }
  | { kind: "stock" }
  | { kind: "timeline" }
  | { kind: "notes" };

const PAGE_BUDGET = 228;

function blockHeight(block: InvoicePageBlock): number {
  if (block.kind === "banner") return 12;
  if (block.kind === "header") return 78;
  if (block.kind === "money") return 62;
  if (block.kind === "stock") return 48;
  if (block.kind === "timeline") return 36;
  if (block.kind === "notes") return 28;
  return 10 + block.rows.reduce((sum, row) => sum + (row.name.length > 80 ? 24 : row.name.length > 36 ? 18 : 12), 0);
}

export function layoutInvoicePages(doc: InvoiceDocument): InvoicePageBlock[][] {
  const blocks: InvoicePageBlock[] = [
    { kind: "banner" },
    { kind: "header" },
  ];
  const chunk: InvoiceDocumentLine[] = [];
  const flush = () => {
    if (!chunk.length) return;
    blocks.push({ kind: "lines", rows: chunk.splice(0, chunk.length) });
  };
  for (const line of doc.lines) {
    chunk.push(line);
    const height = blockHeight({ kind: "lines", rows: chunk });
    if (height > 150) flush();
  }
  flush();
  if (!doc.lines.length) blocks.push({ kind: "lines", rows: [] });
  blocks.push({ kind: "money" }, { kind: "stock" }, { kind: "timeline" }, { kind: "notes" });

  const pages: InvoicePageBlock[][] = [];
  let current: InvoicePageBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    const height = blockHeight(block);
    if (current.length && used + height > PAGE_BUDGET) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += height;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [blocks];
}
