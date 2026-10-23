"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import type { CostingIngredient } from "@/lib/costing/types";
import { planMergedProductSplit } from "@/lib/inventory/product-split";
import type { InventoryMovement, PurchaseInvoice } from "@/lib/inventory/types";

export function SplitMergedProducts({
  product,
  products,
  invoices,
  movements,
  onDone,
}: {
  product: CostingIngredient;
  products: CostingIngredient[];
  invoices: PurchaseInvoice[];
  movements: InventoryMovement[];
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetId, setTargetId] = useState("");
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => invoices.flatMap((invoice) =>
    (invoice.lines ?? [])
      .filter((line) => line.productId === product.id)
      .map((line) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        lineKey: line.key,
        name: line.correctedInvoiceName || line.originalScannedName || line.rawName,
        quantity: line.quantity,
      }))
  ), [invoices, product.id]);
  const selections = rows
    .filter((row) => selected.includes(`${row.invoiceId}:${row.lineKey}`))
    .map((row) => ({ invoiceId: row.invoiceId, lineKey: row.lineKey, targetProductId: targetId || "new-product" }));
  const preview = planMergedProductSplit({
    sourceProductId: product.id,
    lines: rows.map((row) => ({ ...row, productId: product.id })),
    movements,
    selections,
  });

  async function confirm() {
    if (!selections.length || (!targetId && !createName.trim())) return;
    setBusy(true);
    const result = await clientAdminFetch("/api/admin/inventory/product-split", {
      sourceProductId: product.id,
      rows: selections.map((row) => ({ invoiceId: row.invoiceId, lineKey: row.lineKey, targetProductId: targetId || undefined })),
      createName: targetId ? undefined : createName.trim(),
      category: product.category,
    });
    setBusy(false);
    if (!result.ok) {
      onDone(t("admin.inventory.splitFailed"));
      return;
    }
    setOpen(false);
    onDone(t("admin.inventory.splitDone"));
  }

  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-beige-dark/20 p-3">
      <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setOpen((value) => !value)}>
        {t("admin.inventory.splitMerged")}
      </Button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {rows.map((row) => {
            const id = `${row.invoiceId}:${row.lineKey}`;
            return (
              <label key={id} className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(id)} onChange={() => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} />
                <span>{row.name} · {row.quantity ?? "—"} · {row.invoiceNumber || row.invoiceId}</span>
              </label>
            );
          })}
          <select className="h-8 w-full rounded-lg border px-2" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">{t("admin.inventory.createSeparate")}</option>
            {products.filter((item) => item.id !== product.id && item.active !== false).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          {!targetId && (
            <Input value={createName} placeholder={t("admin.inventory.product")} onChange={(event) => setCreateName(event.target.value)} />
          )}
          <p>{t("admin.inventory.splitPreview")}: {preview.movementMoves.map((move) => `${move.quantityBase}`).join(", ") || "0"}</p>
          <Button type="button" variant="turquoise" className="h-8 text-xs" disabled={busy || !selections.length} onClick={() => void confirm()}>
            {t("admin.inventory.splitConfirm")}
          </Button>
        </div>
      )}
    </div>
  );
}
