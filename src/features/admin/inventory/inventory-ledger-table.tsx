"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/components/providers/locale-provider";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient } from "@/lib/costing/types";
import { stockInDisplayUnit } from "@/lib/inventory/issue";
import {
  buildLedgerDetails,
  filterLedgerDetails,
  formatLedgerQuantity,
  ledgerReferenceText,
  type LedgerDetail,
} from "@/lib/inventory/ledger-detail";
import { movementSignedBase } from "@/lib/inventory/stock";
import type { InventoryMovement, PurchaseInvoice, Supplier } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

function balanceLabel(row: LedgerDetail, product: CostingIngredient, t: (key: string) => string): string {
  const amount = stockInDisplayUnit(row.balanceAfterBase, product);
  return `${amount.toFixed(2)} ${t(unitLabelKey(product.purchaseUnit))}`;
}

export function InventoryLedgerTable({
  product,
  movements,
  invoices,
  suppliers,
  highlightMovementId,
  onOpenInvoice,
  movementAction,
}: {
  product: CostingIngredient;
  movements: InventoryMovement[];
  invoices: PurchaseInvoice[];
  suppliers: Supplier[];
  highlightMovementId?: string | null;
  onOpenInvoice?: (invoiceId: string, lineId?: string) => void;
  movementAction?: (movement: InventoryMovement) => ReactNode;
}) {
  const t = useT();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const details = useMemo(
    () => buildLedgerDetails({ movements, productId: product.id, invoices, suppliers }),
    [movements, product.id, invoices, suppliers]
  );
  const visible = useMemo(
    () => filterLedgerDetails(details, { from, to, supplierId }),
    [details, from, to, supplierId]
  );
  const supplierOptions = useMemo(() => {
    const ids = new Set(details.map((row) => row.supplierId).filter((id): id is string => Boolean(id)));
    return [...ids].map((id) => ({
      id,
      name: suppliers.find((item) => item.id === id)?.name || id,
    }));
  }, [details, suppliers]);

  useEffect(() => {
    if (!highlightMovementId) return;
    document.getElementById(`movement-${highlightMovementId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [highlightMovementId, product.id]);

  const openInvoice = (invoiceId: string, lineId?: string) => {
    onOpenInvoice?.(invoiceId, lineId);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-coffee/70">
          <span className="mb-1 block">{t("admin.inventory.ledger.filterFrom")}</span>
          <input className="h-9 rounded-xl border border-beige-dark/40 px-2 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="text-xs text-coffee/70">
          <span className="mb-1 block">{t("admin.inventory.ledger.filterTo")}</span>
          <input className="h-9 rounded-xl border border-beige-dark/40 px-2 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="text-xs text-coffee/70">
          <span className="mb-1 block">{t("admin.inventory.ledger.supplier")}</span>
          <select className="h-9 rounded-xl border border-beige-dark/40 px-2 text-sm" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">{t("admin.inventory.ledger.allSuppliers")}</option>
            {supplierOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="min-w-[1080px] w-full text-sm">
          <thead className="bg-beige/40 text-coffee/70">
            <tr>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.movementDate")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.movementType")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.supplier")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.invoiceNumber")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.invoiceDate")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.invoiceProduct")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.inOut")}</th>
              <th className="px-2 py-2 text-end font-medium">{t("admin.inventory.ledger.balanceAfter")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("admin.inventory.ledger.viewSource")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-3 text-coffee/60">
                  {t("admin.inventory.ledger.noRows")}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const negative = movementSignedBase(row.movement) < 0;
                const source = row.source;
                const invoice = source.kind === "invoice" ? source : null;
                return (
                  <tr
                    key={row.movementId}
                    id={`movement-${row.movementId}`}
                    data-ledger-row={row.movementId}
                    data-balance={row.balanceAfterBase}
                    data-invoice-id={invoice?.invoiceId || ""}
                    data-invoice-line={invoice?.invoiceLineId || ""}
                    data-restored={invoice?.restored ? "true" : "false"}
                    className={cn("border-b border-beige-dark/10", highlightMovementId === row.movementId && "bg-turquoise/15")}
                  >
                    <td className="px-2 py-2">{row.movementDate || "—"}</td>
                    <td className="px-2 py-2">
                      <div>{t(`admin.inventory.movement.${row.movement.type}`, row.movement.type)}</div>
                      {movementAction ? <div className="mt-1">{movementAction(row.movement)}</div> : null}
                    </td>
                    <td className="px-2 py-2">{row.supplierName || "—"}</td>
                    <td className="px-2 py-2">
                      {invoice ? (
                        <button type="button" className="text-turquoise underline" onClick={() => openInvoice(invoice.invoiceId, invoice.invoiceLineId)}>
                          {invoice.invoiceNumber || t("admin.inventory.ledger.savedInvoice")}
                        </button>
                      ) : source.kind === "reference" ? (
                        ledgerReferenceText(source, t)
                      ) : (
                        t("admin.inventory.ledger.unlinked")
                      )}
                    </td>
                    <td className="px-2 py-2" data-invoice-date={invoice?.invoiceDate || ""}>
                      {invoice?.invoiceDate || "—"}
                    </td>
                    <td className="px-2 py-2">{invoice?.productName || "—"}</td>
                    <td className="px-2 py-2">
                      <div>
                        {negative ? "-" : "+"}
                        {formatLedgerQuantity(row.movement.quantity)} {row.movement.unit ? t(unitLabelKey(row.movement.unit)) : ""}
                      </div>
                      {invoice?.quantityMatches === false ? (
                        <p className="text-xs text-amber-800">{t("admin.inventory.ledger.qtyMismatch")}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-end">{balanceLabel(row, product, t)}</td>
                    <td className="px-2 py-2">
                      {invoice ? (
                        <button type="button" className="text-turquoise" onClick={() => openInvoice(invoice.invoiceId, invoice.invoiceLineId)}>
                          {t("admin.inventory.ledger.viewSource")}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
