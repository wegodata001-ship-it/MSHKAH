"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { AdminCard } from "@/features/admin/components/admin-card";
import { formatIls } from "@/lib/costing/money";
import {
  isWritablePurchaseRow,
  planPurchaseList,
  type PurchaseListDecision,
} from "@/lib/inventory/purchase-list";
import { applyPurchaseList, type PurchaseListApplyResult } from "@/services/inventoryService";
import { MaterialGroupSuggest } from "@/features/admin/inventory/material-group-suggest";
import type { InventoryHubProps } from "@/features/admin/inventory/inventory-hub";
import { InvoiceStockTransfer } from "@/features/admin/inventory/invoice-stock-transfer";

type Stage = "idle" | "ready" | "applying" | "applied" | "error";

export function PurchaseListPanel(props: InventoryHubProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [decisions, setDecisions] = useState<Record<string, PurchaseListDecision>>({});
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseListApplyResult | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const busy = stage === "applying";

  const plan = useMemo(
    () =>
      text.trim()
        ? planPurchaseList({
            text,
            ingredients: props.ingredients,
            suppliers: props.suppliers,
            maps: props.itemMaps,
            invoices: props.invoices,
            decisions,
          })
        : null,
    [text, props.ingredients, props.suppliers, props.itemMaps, props.invoices, decisions]
  );

  function patch(key: string, next: PurchaseListDecision) {
    setDecisions((current) => ({ ...current, [key]: { ...current[key], ...next } }));
  }

  async function onFile(file: File) {
    const content = await file.text();
    setFileName(file.name);
    setText(content);
    setDecisions({});
    setResult(null);
    setError(null);
    setStage(content.trim() ? "ready" : "idle");
  }

  async function apply() {
    if (!text.trim() || busy) return;
    setStage("applying");
    setError(null);
    const saved = await applyPurchaseList({
      text,
      ingredients: props.ingredients,
      suppliers: props.suppliers,
      maps: props.itemMaps ?? [],
      invoices: props.invoices,
      decisions,
      fileName: fileName || undefined,
    });
    if (!saved.success) {
      setError(saved.error);
      setStage("error");
      props.onToast(saved.error, "error");
      return;
    }
    setResult(saved.data);
    setStage("applied");
    props.onToast(t("admin.purchaseList.saved"));
  }

  const transferInvoice = transferId ? props.invoices.find((item) => item.id === transferId) : null;
  if (transferInvoice) {
    return (
      <InvoiceStockTransfer
        invoice={transferInvoice}
        ingredients={props.ingredients}
        suppliers={props.suppliers}
        onToast={props.onToast}
        onClose={() => setTransferId(null)}
        skipFinanceSave
      />
    );
  }

  const verifiedCreated = result
    ? result.createdIngredients.filter((item) => props.ingredients.some((row) => row.id === item.id))
    : [];
  const verifiedMatched = result
    ? result.matchedIngredients.filter((item) => props.ingredients.some((row) => row.id === item.id))
    : [];
  const verifiedPurchases = result
    ? result.invoicesSaved.filter((item) => props.invoices.some((row) => row.id === item.id || (row.supplierId === item.supplierId && row.invoiceNumber === item.invoiceNumber)))
    : [];

  return (
    <div className="space-y-4">
      <AdminCard title={t("admin.purchaseList.title")}>
        <p className="mb-3 text-sm text-coffee/60">{t("admin.purchaseList.hint")}</p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".md,.txt,.csv,text/markdown,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = "";
            }}
          />
          <Button type="button" variant="turquoise" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" /> {t("admin.purchaseList.upload")}
          </Button>
          {fileName ? <span className="self-center text-sm text-coffee/60">{fileName}</span> : null}
        </div>
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
            setStage(event.target.value.trim() ? "ready" : "idle");
          }}
          rows={8}
          className="mt-3 w-full rounded-xl border border-beige-dark/30 p-3 text-sm"
          placeholder={t("admin.purchaseList.paste")}
          dir="rtl"
        />
      </AdminCard>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {plan && stage !== "applied" && (
        <AdminCard title={t("admin.purchaseList.summary")}>
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
            <p>{t("admin.purchaseList.detailRows")}: {plan.detailLines.length}</p>
            <p>{t("admin.purchaseList.summaryCheck")}: {plan.summaryLines.length}</p>
            <p>{t("admin.purchaseList.willCreate")}: {plan.createIngredientCount}</p>
            <p>{t("admin.purchaseList.willMatch")}: {plan.existingIngredientCount}</p>
            <p>{t("admin.purchaseList.suppliersNew")}: {plan.createSupplierNames.join(" · ") || "—"}</p>
            <p>{t("admin.purchaseList.invoices")}: {plan.invoiceCount}</p>
            <p>{t("admin.purchaseList.review")}: {plan.reviewCount}</p>
          </div>
          <p className="mb-3 text-sm text-coffee/60">{t("admin.purchaseList.historyOnly")}</p>
          {plan.summaryGaps.some((gap) => gap.detailQty != null && gap.summaryQty != null && gap.detailQty !== gap.summaryQty) && (
            <p className="mb-3 text-sm text-amber-800">{t("admin.purchaseList.summaryGap")}</p>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-start text-coffee/55">
                  <th className="p-2">{t("admin.purchaseList.sourceName")}</th>
                  <th className="p-2">{t("admin.purchaseList.unifiedName")}</th>
                  <th className="p-2">{t("admin.costing.supplier")}</th>
                  <th className="p-2">{t("admin.costing.category")}</th>
                  <th className="p-2">{t("admin.purchaseList.unit")}</th>
                  <th className="p-2">{t("admin.purchaseList.conversion")}</th>
                  <th className="p-2">{t("admin.purchaseList.buyPrice")}</th>
                  <th className="p-2">{t("admin.purchaseList.qty")}</th>
                  <th className="p-2">{t("admin.purchaseList.identity")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.key} className={row.excluded ? "opacity-40" : undefined}>
                    <td className="p-2 align-top">{row.sourceName}</td>
                    <td className="p-2 align-top">
                      <Input
                        value={decisions[row.key]?.canonicalName ?? row.canonicalName}
                        onChange={(event) => patch(row.key, { canonicalName: event.target.value })}
                        className="min-w-40"
                      />
                    </td>
                    <td className="p-2 align-top">{row.supplierName}</td>
                    <td className="p-2 align-top">
                      <Input
                        value={decisions[row.key]?.category ?? row.category}
                        onChange={(event) => patch(row.key, { category: event.target.value })}
                        className="min-w-28"
                      />
                    </td>
                    <td className="p-2 align-top">{row.purchaseUnit}</td>
                    <td className="p-2 align-top">
                      <span className={row.pack.needsReview ? "text-amber-800" : undefined}>{row.pack.note}</span>
                    </td>
                    <td className="p-2 align-top">
                      {row.lineNet != null ? formatIls(row.lineNet) : row.unitPrice != null ? formatIls(row.unitPrice) : "—"}
                    </td>
                    <td className="p-2 align-top">{row.quantity ?? "—"}</td>
                    <td className="p-2 align-top">
                      {row.identity === "existing" ? t("admin.purchaseList.existing") : row.identity === "uncertain" ? t("admin.purchaseList.uncertain") : t("admin.purchaseList.newItem")}
                      {row.identity === "uncertain" && row.alternatives.length > 0 && (
                        <select
                          className="mt-1 block h-9 rounded-xl border px-2"
                          value={decisions[row.key]?.ingredientId ?? ""}
                          onChange={(event) =>
                            patch(row.key, {
                              ingredientId: event.target.value,
                              acceptSuggest: Boolean(event.target.value),
                            })
                          }
                        >
                          <option value="">{t("admin.purchaseList.keepNew")}</option>
                          {row.alternatives.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {row.needs.length > 0 && (
                        <p className="mt-1 text-xs text-amber-800">
                          {t("admin.purchaseList.needs")}: {row.needs.join(", ")}
                        </p>
                      )}
                      {row.duplicateInvoice && <p className="mt-1 text-xs text-coffee/55">{t("admin.purchaseList.duplicateInvoice")}</p>}
                      <MaterialGroupSuggest
                        line={{
                          name: row.sourceName,
                          productId: row.ingredientId,
                          matchKind: row.identity === "existing" ? "exact" : row.identity === "uncertain" ? "suggest" : "new",
                          matchConfirmed: row.identity === "existing",
                          quantity: row.quantity,
                          unit: row.purchaseUnit,
                          conversionFactor: row.pack.packSize,
                          lineNet: row.lineNet,
                          lineGross: row.lineGross,
                          unitPrice: row.unitPrice,
                        }}
                        ingredients={props.ingredients}
                        maps={props.itemMaps}
                        offers={props.offers}
                        suppliers={props.suppliers}
                        supplierId={row.supplierId}
                        onAssignSame={(item) => patch(row.key, { ingredientId: item.id, acceptSuggest: true, canonicalName: item.name })}
                        onCreateUnified={(name) => patch(row.key, { canonicalName: name })}
                        onKeepSeparate={() => patch(row.key, { ingredientId: "", acceptSuggest: false })}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Button type="button" variant="outline" onClick={() => patch(row.key, { excluded: !row.excluded })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <Button type="button" variant="turquoise" disabled={busy || !plan.selectedRows.some(isWritablePurchaseRow)} onClick={() => void apply()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("admin.purchaseList.approve")}
            </Button>
          </div>
        </AdminCard>
      )}

      {stage === "applied" && result && (
        <AdminCard title={t("admin.purchaseList.report")}>
          {verifiedCreated.length !== result.createdIngredients.length || (verifiedPurchases.length === 0 && result.purchasesSaved > 0) ? (
            <p className="mb-3 text-sm text-coffee/60">{t("admin.purchaseList.waitingRead")}</p>
          ) : null}
          <div className="space-y-1 text-sm">
            <p>{t("admin.purchaseList.createdCount")}: {verifiedCreated.length} / {result.createdIngredients.length}</p>
            <p>{t("admin.purchaseList.matchedCount")}: {verifiedMatched.length}</p>
            <p>{t("admin.purchaseList.suppliersCreated")}: {result.createdSuppliers.map((item) => item.name).join(" · ") || "—"}</p>
            <p>{t("admin.purchaseList.purchasesSaved")}: {result.purchasesSaved}</p>
            <p>{t("admin.purchaseList.skippedInvoices")}: {result.skippedDuplicates}</p>
            <p>{t("admin.purchaseList.incompleteCount")}: {result.incomplete.length}</p>
            <p>{t("admin.purchaseList.noStockNoFinance")}</p>
          </div>
          {result.createdIngredients.length > 0 && (
            <p className="mt-2 text-sm">{verifiedCreated.map((item) => item.name).join(" · ")}</p>
          )}
          {result.incomplete.length > 0 && (
            <ul className="mt-2 list-disc pe-5 text-sm text-amber-800">
              {result.incomplete.map((item) => (
                <li key={item.key}>{item.sourceName}: {item.needs.join(", ")}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold">{t("admin.purchaseList.stockStep")}</p>
            {result.invoicesSaved.filter((item) => item.id && !item.skippedDuplicate).map((item) => (
              <Button key={item.id} type="button" variant="outline" onClick={() => setTransferId(item.id)}>
                {t("admin.purchaseList.receiveInvoice")}: {item.invoiceNumber}
              </Button>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  );
}
