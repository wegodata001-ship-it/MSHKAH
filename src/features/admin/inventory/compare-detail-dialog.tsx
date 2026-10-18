"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { PurchaseUnit } from "@/lib/costing/types";
import { PURCHASE_UNITS } from "@/lib/costing/units";
import {
  compareFormulaParts,
  compareHistoryLines,
  formatCompareMoney,
  formatComparePercent,
} from "@/lib/inventory/compare-display";
import type { CompareVatMode, MaterialCompareRow } from "@/lib/inventory/material-group";
import type { PurchaseInvoice, PurchasePriceRecord, Supplier } from "@/lib/inventory/types";
import { saveComparePack, saveComparePurchaseBasis } from "@/services/inventoryService";

export function CompareDetailDialog({
  row,
  rows,
  records,
  invoices,
  suppliers,
  vatMode,
  groupName,
  onClose,
  onSaved,
}: {
  row: MaterialCompareRow | null;
  rows: MaterialCompareRow[];
  records: PurchasePriceRecord[];
  invoices: PurchaseInvoice[];
  suppliers: Supplier[];
  vatMode: CompareVatMode;
  groupName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const history = row ? compareHistoryLines(records, row.ingredientId, row.supplierId, vatMode) : [];
  const latest = history[0] ?? null;
  const formula = row ? compareFormulaParts(row) : null;
  const cheapest = rows.find((item) => item.cheapest && item.displayUnit === row?.displayUnit);
  const basisLabel = vatMode === "net" ? t("admin.finance.compareNet") : t("admin.finance.compareGross");
  const eachLabel = formula ? t(eachKey(formula.displayUnit)) : "";
  const missingBasis = Boolean(row && ((!row.supplierId && !row.supplierName.trim()) || row.buyPrice == null));
  const needsCompletion = Boolean(
    row && (missingBasis || row.reason === "missing-pack" || row.reason === "vat-mismatch" || row.reason === "unit-mismatch")
  );

  return (
    <Dialog open={row != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-full max-w-lg gap-3 p-4 sm:p-5">
        {row && (
          <>
            <DialogTitle className="pe-8 text-lg">{t("admin.compare.details")}</DialogTitle>
            <DialogDescription>
              {t("admin.compare.savedPurchases")}
              {row.purchaseDate ? ` · ${row.purchaseDate}` : ""}
            </DialogDescription>
            <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto pe-1 text-sm">
              <section>
                <p className="font-medium">{row.supplierProductName}</p>
                <p className="text-coffee/70">{row.supplierName || "—"}</p>
                <p className="text-coffee/70">{groupName}</p>
              </section>

              <section className="rounded-xl bg-beige/40 p-3">
                <p className="mb-1 text-xs text-coffee/55">{basisLabel}</p>
                {formula ? (
                  <p className="font-medium tabular-nums" dir="ltr">
                    {formula.pack} ÷ {formula.quantity} = {formula.unitPrice} ₪ {eachLabel} {basisLabel}
                  </p>
                ) : (
                  <p className="text-amber-800">{reasonText(row, t)}</p>
                )}
              </section>

              <section>
                <p className="mb-1 font-medium">{t("admin.compare.vsCheapest")}</p>
                {cheapest && row.cheapest ? (
                  <p>{t("admin.compare.isCheapest")}</p>
                ) : cheapest && cheapest.displayUnitCost != null && row.gapAmount != null ? (
                  <p className="tabular-nums">
                    {cheapest.supplierName} · {formatCompareMoney(cheapest.displayUnitCost)} / {t(unitLabelKey(cheapest.displayUnit))}
                    {" · +"}
                    {formatCompareMoney(row.gapAmount)}
                    {row.gapPercent != null ? ` · +${formatComparePercent(row.gapPercent)}%` : ""}
                  </p>
                ) : (
                  <p className="text-coffee/70">{t("admin.compare.noPeer")}</p>
                )}
              </section>

              <section>
                <p className="mb-1 font-medium">{t("admin.compare.vatSaved")}</p>
                {latest ? (
                  <ul className="space-y-1 tabular-nums">
                    <li>
                      {t("admin.compare.priceBeforeVat")}: {latest.net != null ? formatCompareMoney(latest.net) : "—"}
                    </li>
                    <li>
                      {t("admin.compare.vatAmount")}: {latest.vat != null ? formatCompareMoney(latest.vat) : "—"}
                    </li>
                    <li>
                      {t("admin.compare.priceIncludingVat")}: {latest.gross != null ? formatCompareMoney(latest.gross) : "—"}
                    </li>
                  </ul>
                ) : (
                  <p className="text-coffee/70">{t("admin.compare.noHistory")}</p>
                )}
                {latest?.differenceIsStoredVat && latest.net != null && latest.gross != null && latest.vat != null && (
                  <p className="mt-2 text-coffee/80">
                    {t("admin.compare.vatMatches")
                      .replace("{net}", formatCompareMoney(latest.net))
                      .replace("{gross}", formatCompareMoney(latest.gross))
                      .replace("{vat}", formatCompareMoney(latest.vat))}
                  </p>
                )}
                {latest && latest.net != null && latest.vat != null && latest.gross != null && !latest.differenceIsStoredVat && (
                  <p className="mt-2 text-amber-800">{t("admin.compare.vatUnconfirmed")}</p>
                )}
                {latest && latest.packPrice == null && <p className="mt-2 text-amber-800">{t("admin.compare.missingSelectedBasis")}</p>}
              </section>

              <section>
                <p className="mb-1 font-medium">{t("admin.inventory.priceHistory")}</p>
                {history.length === 0 ? (
                  <p className="text-coffee/70">{t("admin.compare.noHistory")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-coffee/55">
                          <th className="px-1 py-1 text-start font-medium">{t("admin.compare.historyDate")}</th>
                          <th className="px-1 py-1 text-start font-medium">{t("admin.compare.packPrice")}</th>
                          <th className="px-1 py-1 text-start font-medium">{t("admin.compare.baseUnitPrice")}</th>
                          <th className="px-1 py-1 text-start font-medium">{t("admin.compare.historyDoc")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((line) => {
                          const invoice = line.invoiceId ? invoices.find((item) => item.id === line.invoiceId) : undefined;
                          const href = invoice?.sourceFile?.downloadUrl;
                          const number = invoice?.invoiceNumber;
                          return (
                            <tr key={line.id} className="border-t border-beige-dark/10">
                              <td className="px-1 py-1">{line.date}</td>
                              <td className="px-1 py-1 tabular-nums">
                                {line.packPrice != null ? formatCompareMoney(line.packPrice) : t("admin.compare.missingSelectedBasis")}
                              </td>
                              <td className="px-1 py-1 tabular-nums">
                                {line.unitPrice != null ? formatCompareMoney(line.unitPrice) : "—"}
                              </td>
                              <td className="px-1 py-1">
                                {line.source === "invoice" ? (
                                  href && number ? (
                                    <a className="text-turquoise underline" href={href} target="_blank" rel="noreferrer">
                                      {number}
                                    </a>
                                  ) : (
                                    number || t("admin.inventory.sourceInvoice")
                                  )
                                ) : (
                                  t("admin.inventory.sourceManual")
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {needsCompletion && (
                <CompletionForm
                  key={`${row.ingredientId}-${row.supplierId}-${vatMode}`}
                  row={row}
                  suppliers={suppliers}
                  vatMode={vatMode}
                  onSaved={onSaved}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CompletionForm({
  row,
  suppliers,
  vatMode,
  onSaved,
}: {
  row: MaterialCompareRow;
  suppliers: Supplier[];
  vatMode: CompareVatMode;
  onSaved: () => void;
}) {
  const t = useT();
  const [packQty, setPackQty] = useState(row.packQuantity != null ? String(row.packQuantity) : "");
  const [packUnit, setPackUnit] = useState<PurchaseUnit>(row.packUnit ?? "unit");
  const [basisSupplier, setBasisSupplier] = useState(row.supplierId);
  const [basisPrice, setBasisPrice] = useState(row.buyPrice != null ? String(row.buyPrice) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const missingBasis = (!row.supplierId && !row.supplierName.trim()) || row.buyPrice == null || row.reason === "vat-mismatch" || row.reason === "unit-mismatch";

  return (
    <section className="rounded-xl border border-amber-200 p-3">
      <p className="mb-2 text-amber-800">{reasonText(row, t)}</p>
      <div className="flex flex-wrap items-center gap-1">
        {missingBasis && (
          <>
            <select className="h-9 rounded-lg border px-1 text-xs" value={basisSupplier} onChange={(e) => setBasisSupplier(e.target.value)}>
              <option value="">{t("admin.costing.supplier")}</option>
              {suppliers
                .filter((item) => item.active !== false)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
            <Input className="h-9 w-24" value={basisPrice} inputMode="decimal" placeholder={t("admin.compare.packPrice")} onChange={(e) => setBasisPrice(e.target.value)} />
          </>
        )}
        <Input className="h-9 w-16" value={packQty} inputMode="decimal" onChange={(e) => setPackQty(e.target.value)} />
        <select className="h-9 rounded-lg border px-1 text-xs" value={packUnit} onChange={(e) => setPackUnit(e.target.value as PurchaseUnit)}>
          {PURCHASE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(unitLabelKey(unit))}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="turquoise"
          disabled={saving}
          onClick={async () => {
            if (lock.current) return;
            const qty = Number(packQty.replace(",", "."));
            const price = Number(basisPrice.replace(",", "."));
            if (!(qty > 0) || (missingBasis && (!basisSupplier || !(price > 0)))) {
              setError(t("admin.compare.saveFailed"));
              return;
            }
            lock.current = true;
            setSaving(true);
            setError(null);
            const saved = missingBasis
              ? await saveComparePurchaseBasis({
                  productId: row.ingredientId,
                  supplierId: basisSupplier,
                  price,
                  packageQuantity: qty,
                  purchaseUnit: packUnit,
                  vatMode,
                })
              : await saveComparePack({
                  productId: row.ingredientId,
                  supplierId: row.supplierId,
                  packageQuantity: qty,
                  purchaseUnit: packUnit,
                });
            lock.current = false;
            setSaving(false);
            if (!saved.success) {
              setError(t("admin.compare.saveFailed"));
              return;
            }
            onSaved();
          }}
        >
          {saving ? t("admin.compare.saving") : t("common.save")}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}

function eachKey(unit: MaterialCompareRow["displayUnit"]): string {
  if (unit === "kg") return "admin.compare.eachKg";
  if (unit === "liter") return "admin.compare.eachLiter";
  return "admin.compare.eachUnit";
}

function reasonText(row: MaterialCompareRow, t: (key: string, fallback?: string) => string): string {
  if (row.reason === "missing-pack") return t("admin.compare.missingPackExplain");
  if (row.reason === "unit-mismatch") return t("admin.compare.unitMismatchExplain");
  if (row.reason === "vat-mismatch") return t("admin.compare.vatMismatchExplain");
  if ((!row.supplierId && !row.supplierName.trim()) || row.buyPrice == null || row.reason === "missing-price") {
    return t("admin.compare.missingSupplierPrice");
  }
  return t("admin.compare.calcMissing");
}
