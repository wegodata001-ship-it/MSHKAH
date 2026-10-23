"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { isNonStockInvoiceLine } from "@/lib/inventory/invoice-lines";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "@/lib/inventory/types";

export function InvoiceLineNameEditor({
  invoice,
  onClose,
  onSaved,
  onToast,
}: {
  invoice: PurchaseInvoice;
  onClose: () => void;
  onSaved: (invoice: PurchaseInvoice) => void;
  onToast?: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const lines = (invoice.lines ?? []).filter((line) => !isNonStockInvoiceLine(line));
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.key, line.correctedInvoiceName || line.rawName]))
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function save(line: PurchaseInvoiceLine, updateInventory: boolean) {
    const name = (drafts[line.key] ?? "").trim();
    if (!name || !invoice.id) return;
    setBusy(line.key);
    const result = await clientAdminFetch<{ invoice?: PurchaseInvoice }>("/api/admin/inventory/invoice/line-name", {
      invoiceId: invoice.id,
      lineKey: line.key,
      name,
      updateInventory,
      productId: line.productId,
    });
    setBusy(null);
    if (!result.ok || !result.data?.invoice) {
      onToast?.(t("admin.inventory.lineNameFailed"), "error");
      return;
    }
    onSaved(result.data.invoice);
    onToast?.(updateInventory ? t("admin.inventory.renameInventoryDone") : t("admin.inventory.lineNameSaved"), "success");
  }

  return (
    <div className="rounded-2xl border border-beige-dark/15 bg-warm-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("admin.inventory.editLineNames")}</p>
        <Button type="button" variant="ghost" className="h-8 text-xs" onClick={onClose}>{t("common.cancel")}</Button>
      </div>
      <p className="mb-3 text-xs text-coffee/60">{t("admin.inventory.renameInvoiceOnlyHint")}</p>
      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 rounded-xl bg-beige/30 p-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div>
              <Input
                value={drafts[line.key] ?? ""}
                aria-label={t("admin.inventory.editLineName")}
                onChange={(event) => setDrafts((current) => ({ ...current, [line.key]: event.target.value }))}
              />
              {line.originalScannedName && line.originalScannedName !== (drafts[line.key] ?? "").trim() ? (
                <p className="mt-1 text-[11px] text-coffee/50">{t("admin.inventory.originalName")}: {line.originalScannedName}</p>
              ) : null}
            </div>
            <Button type="button" variant="outline" className="h-9 text-xs" disabled={busy === line.key} onClick={() => void save(line, false)}>
              <Pencil className="me-1 h-3.5 w-3.5" />
              {t("admin.inventory.renameInvoiceOnly")}
            </Button>
            <Button type="button" variant="turquoise" className="h-9 text-xs" disabled={busy === line.key || !line.productId} onClick={() => void save(line, true)}>
              {t("admin.inventory.renameInventory")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
