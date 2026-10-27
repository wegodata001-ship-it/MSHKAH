import { invoiceLineQuantityBase } from "@/lib/inventory/ingredient-core";
import { isNonStockInvoiceLine } from "@/lib/inventory/invoice-lines";
import { invoicePurchaseMovementId } from "@/lib/inventory/invoice-stock-post";
import type { PurchaseInvoiceLine } from "@/lib/inventory/types";

export type StockAuditKind = "ok" | "missing-movement" | "quantity-gap" | "duplicate-movement" | "unusual";

export type StockAuditFinding = {
  invoiceId: string;
  lineKey: string;
  productId?: string;
  purchaseQuantity: number | null;
  unit: string | null;
  expectedStock: number | null;
  recordedStock: number | null;
  kind: StockAuditKind;
  proposed: string;
};

type MovementRow = { id: string; quantityBase?: number | null };

/**
 * Read-only comparison of invoice lines with stock movements.
 * The result is a report. It does not change stock.
 */
export function auditInvoiceMovements(input: {
  invoiceId: string;
  lines: PurchaseInvoiceLine[];
  movements: MovementRow[];
}): StockAuditFinding[] {
  const counts = new Map<string, number>();
  for (const movement of input.movements) counts.set(movement.id, (counts.get(movement.id) ?? 0) + 1);
  const findings: StockAuditFinding[] = [];
  for (const line of input.lines) {
    if (isNonStockInvoiceLine(line) || !line.productId) continue;
    const movementId = invoicePurchaseMovementId(input.invoiceId, line.key);
    const matches = input.movements.filter((movement) => movement.id === movementId);
    const expected = invoiceLineQuantityBase(line);
    const recorded = matches[0]?.quantityBase ?? null;
    const purchase = Number(line.quantity);
    let kind: StockAuditKind = "ok";
    let proposed = "אין שינוי";
    if ((counts.get(movementId) ?? 0) > 1) {
      kind = "duplicate-movement";
      proposed = "להשאיר תנועה אחת ולבטל את הכפילות אחרי גיבוי";
    } else if (!matches.length) {
      kind = "missing-movement";
      proposed = expected != null ? `לקלוט ${expected} אחרי אישור` : "השורה בלי כמות מלאי";
    } else if (expected == null || recorded == null || Math.abs(expected - recorded) > 0.0001) {
      kind = "quantity-gap";
      proposed = `המלאי שנרשם ${recorded ?? "—"} והכמות לפי החשבונית ${expected ?? "—"}. לא לתקן בלי גיבוי`;
    } else if (Number.isFinite(purchase) && purchase > 0 && line.unit === "unit" && expected != null && expected > purchase * 5) {
      kind = "unusual";
      proposed = "כמות היחידות גדולה פי כמה מהכמות בחשבונית. לבדוק המרה";
    }
    findings.push({
      invoiceId: input.invoiceId,
      lineKey: line.key,
      productId: line.productId,
      purchaseQuantity: Number.isFinite(purchase) ? purchase : null,
      unit: line.unit,
      expectedStock: expected,
      recordedStock: recorded,
      kind,
      proposed,
    });
  }
  return findings;
}
