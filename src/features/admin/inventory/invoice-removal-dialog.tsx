"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { PURGE_PHRASE, type RemovalSummary } from "@/lib/inventory/invoice-removal";
import { archiveInvoices, previewInvoiceRemoval, purgeInvoices } from "@/services/invoice-admin-client";

export function InvoiceRemovalDialog({
  target,
  scope,
  ids,
  onClose,
  onDone,
}: {
  target: "selected" | "all";
  scope: "active" | "archive";
  ids: string[];
  onClose: () => void;
  onDone: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [summary, setSummary] = useState<(RemovalSummary & { ids: string[] }) | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewInvoiceRemoval(scope, target === "all" ? undefined : ids).then((result) => {
      if (cancelled || !result.ok || !result.data) return;
      setSummary(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [ids, scope, target]);

  const blocked = (summary?.purgeBlockedIds.length ?? 0) > 0;
  const phraseOk = phrase === PURGE_PHRASE;
  const targetIds = summary ? (target === "all" ? summary.ids : ids) : [];

  async function run(kind: "archive" | "purge") {
    if (!targetIds.length) return;
    setBusy(true);
    const result = kind === "purge" ? await purgeInvoices(targetIds, phrase) : await archiveInvoices(targetIds);
    setBusy(false);
    if (!result.ok) {
      const code = result.code || "FAILED";
      onDone(t(`admin.inventory.hub.remove.err.${code}`), "error");
      return;
    }
    onDone(kind === "purge" ? t("admin.inventory.hub.remove.donePurge") : t("admin.inventory.hub.remove.doneArchive"), "success");
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg bg-warm-white">
        <DialogHeader className="text-start">
          <DialogTitle>{target === "all" ? t("admin.inventory.hub.remove.titleAll") : t("admin.inventory.hub.remove.titleSelected")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-6 text-coffee/80">{t("admin.inventory.hub.remove.body")}</p>
        {summary ? (
          <ul className="space-y-1 text-sm text-dark-brown">
            <li>{t("admin.inventory.hub.remove.count")}: {summary.count}</li>
            <li>{t("admin.inventory.hub.remove.posted")}: {summary.posted}</li>
            <li>{t("admin.inventory.hub.remove.review")}: {summary.inReview}</li>
            <li>{t("admin.inventory.hub.remove.source")}: {summary.withSource}</li>
            <li>{t("admin.inventory.hub.remove.movements")}: {summary.withMovements > 0 ? t("admin.inventory.hub.remove.yes") : t("admin.inventory.hub.remove.no")} ({summary.withMovements})</li>
            <li>{t("admin.inventory.hub.remove.payments")}: {summary.withPayments > 0 ? t("admin.inventory.hub.remove.yes") : t("admin.inventory.hub.remove.no")} ({summary.withPayments})</li>
          </ul>
        ) : (
          <p className="text-sm text-coffee/60">{t("admin.inventory.hub.pdf.loading")}</p>
        )}
        <p className="text-xs leading-5 text-coffee/70">{t("admin.inventory.hub.remove.keep")}</p>
        {blocked ? <p className="text-sm text-red-700">{t("admin.inventory.hub.remove.blocked")}</p> : null}
        <label className="block text-sm">
          <span className="mb-1 block text-coffee/70">{t("admin.inventory.hub.remove.phraseHint")}</span>
          <Input dir="ltr" value={phrase} onChange={(event) => setPhrase(event.target.value)} className="font-mono" autoComplete="off" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("admin.inventory.hub.remove.cancel")}</Button>
          {scope === "active" ? (
            <Button type="button" variant="turquoise" disabled={busy || !summary || !targetIds.length} onClick={() => void run("archive")}>
              {t("admin.inventory.hub.remove.archive")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="text-red-700" disabled={busy || !phraseOk || blocked || !summary || !targetIds.length} onClick={() => void run("purge")}>
            {t("admin.inventory.hub.remove.purge")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
