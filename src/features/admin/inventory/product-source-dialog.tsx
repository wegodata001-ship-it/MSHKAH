"use client";

import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import { useT } from "@/components/providers/locale-provider";
import type { CostingIngredient } from "@/lib/costing/types";
import type { ProductIntake, ProductSource } from "@/lib/inventory/product-source";

function fill(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

export function intakeLabel(intake: ProductIntake, t: (key: string, fallback?: string) => string): string {
  if (intake.kind === "invoice") {
    if (intake.invoiceNumber && intake.supplierProductName) {
      return fill(t("admin.inventory.source.invoiceNamed"), { number: intake.invoiceNumber, name: intake.supplierProductName });
    }
    if (intake.invoiceNumber) return fill(t("admin.inventory.source.invoice"), { number: intake.invoiceNumber });
    return t("admin.inventory.source.kind.invoice");
  }
  if (intake.kind === "purchase-file") {
    if (intake.fileName) return fill(t("admin.inventory.source.fileNamed"), { name: intake.fileName });
    return t("admin.inventory.source.file");
  }
  if (intake.kind === "manual") return t("admin.inventory.source.manual");
  if (intake.detail === "count") return t("admin.inventory.source.count");
  if (intake.detail === "merge") return t("admin.inventory.source.merge");
  return t("admin.inventory.source.other");
}

export function sourceSummaryText(source: ProductSource, t: (key: string, fallback?: string) => string): string {
  const summary = source.summary;
  if (summary.code === "intake") {
    const intake = source.intakes.find((row) => row.id === summary.intakeId);
    const label = intake ? intakeLabel(intake, t) : t("admin.inventory.source.other");
    return summary.more ? `${label} · ${t("admin.inventory.source.allMovements")}` : label;
  }
  if (summary.code === "import-without-stock") return t("admin.inventory.source.importNoStock");
  if (summary.code === "created-invoice") return createdInvoiceText(source, t);
  if (summary.code === "created-manual") return t("admin.inventory.source.createdManual");
  if (summary.code === "created-other") return t("admin.inventory.source.createdOther");
  return t("admin.inventory.source.undocumented");
}

function createdInvoiceText(source: ProductSource, t: (key: string, fallback?: string) => string): string {
  const number = source.creation.invoiceNumber ?? "";
  const name = source.creation.supplierProductName ?? "";
  if (number && name) return fill(t("admin.inventory.source.createdInvoiceNamed"), { number, name });
  if (number) return fill(t("admin.inventory.source.createdInvoice"), { number });
  return t("admin.inventory.source.kind.invoice");
}

export function creationText(source: ProductSource, t: (key: string, fallback?: string) => string): string {
  if (source.creation.kind === "purchase-file") {
    if (!source.intakes.length) return t("admin.inventory.source.importNoStock");
    if (source.creation.fileName) return fill(t("admin.inventory.source.createdFileNamed"), { name: source.creation.fileName });
    return t("admin.inventory.source.createdFile");
  }
  if (source.creation.kind === "invoice") return createdInvoiceText(source, t);
  if (source.creation.kind === "manual") return t("admin.inventory.source.createdManual");
  if (source.creation.kind === "other") return t("admin.inventory.source.createdOther");
  return t("admin.inventory.source.undocumented");
}

function kindLabel(kind: ProductIntake["kind"] | ProductSource["creation"]["kind"], detail: ProductIntake["detail"], t: (key: string) => string) {
  if (detail === "count") return t("admin.inventory.source.count");
  if (detail === "merge") return t("admin.inventory.source.merge");
  if (kind === "invoice") return t("admin.inventory.source.kind.invoice");
  if (kind === "purchase-file") return t("admin.inventory.source.file");
  if (kind === "manual") return t("admin.inventory.source.manual");
  if (kind === "other") return t("admin.inventory.source.other");
  return t("admin.inventory.source.undocumented");
}

export function ProductSourceDialog({
  product,
  source,
  onClose,
  onOpenInvoice,
  onOpenMovement,
  onEditInvoice,
}: {
  product: CostingIngredient;
  source: ProductSource;
  onClose: () => void;
  onOpenInvoice?: (invoiceId: string, lineId?: string) => void;
  onOpenMovement?: (movementId: string) => void;
  onEditInvoice?: (invoiceId: string) => void;
}) {
  const t = useT();
  const creationName = source.creation.supplierProductName;
  return (
    <AdminModal open onOpenChange={(next) => !next && onClose()} size="lg">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.inventory.sourceDetails")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-3">
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-coffee/60">{t("admin.inventory.source.unified")}: </span>
            <span className="font-medium">{product.compareGroupName || product.name}</span>
            {product.compareGroupName ? <span className="text-coffee/60"> · {product.name}</span> : null}
          </p>
          <p>
            <span className="text-coffee/60">{t("admin.inventory.source.creation")}: </span>
            {creationText(source, t)}
          </p>
          {creationName ? (
            <p>
              <span className="text-coffee/60">{t("admin.inventory.source.supplierName")}: </span>
              {creationName}
            </p>
          ) : null}
          {source.supplierProductNames
            .filter((item) => !(item.name === creationName && item.supplierId === source.creation.supplierId))
            .map((item) => (
            <p key={`${item.supplierId ?? ""}-${item.name}`}>
              <span className="text-coffee/60">{t("admin.inventory.source.supplierName")}: </span>
              {item.name}
              {item.supplierName ? <span className="text-coffee/60"> · {item.supplierName}</span> : null}
            </p>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            {source.creation.invoiceId && onOpenInvoice ? (
              <button type="button" className="text-turquoise" onClick={() => onOpenInvoice(source.creation.invoiceId!)}>
                {t("admin.inventory.source.openInvoice")}
              </button>
            ) : null}
            {source.creation.invoiceId && onEditInvoice ? (
              <button type="button" className="text-turquoise" onClick={() => onEditInvoice(source.creation.invoiceId!)}>
                {t("admin.inventory.editInvoice")}
              </button>
            ) : null}
            {source.creation.fileUrl ? (
              <a className="text-turquoise" href={source.creation.fileUrl} target="_blank" rel="noreferrer">
                {t("admin.inventory.source.openFile")}
              </a>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="bg-beige/40 text-coffee/70">
              <tr>
                <th className="px-2 py-2 text-start">{t("admin.inventory.source.date")}</th>
                <th className="px-2 py-2 text-start">{t("admin.inventory.source.kind")}</th>
                <th className="px-2 py-2 text-start">{t("admin.costing.supplier")}</th>
                <th className="px-2 py-2 text-start">{t("admin.inventory.source.document")}</th>
                <th className="px-2 py-2 text-end">{t("admin.inventory.source.quantity")}</th>
                <th className="px-2 py-2 text-start">{t("admin.inventory.source.actor")}</th>
                <th className="px-2 py-2 text-start">{t("admin.inventory.source.open")}</th>
              </tr>
            </thead>
            <tbody>
              {source.intakes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-coffee/60">
                    {source.summary.code === "import-without-stock" ? t("admin.inventory.source.importNoStock") : t("admin.inventory.source.noIntakes")}
                  </td>
                </tr>
              ) : (
                source.intakes.map((row) => (
                  <tr key={row.id} className="border-t border-beige-dark/10">
                    <td className="px-2 py-2">{row.at.slice(0, 10) || "—"}</td>
                    <td className="px-2 py-2">{kindLabel(row.kind, row.detail, t)}</td>
                    <td className="px-2 py-2">{row.supplierName || "—"}</td>
                    <td className="px-2 py-2">
                      <div>{[row.invoiceNumber, row.fileName].filter(Boolean).join(" · ") || "—"}</div>
                      {row.supplierProductName ? <div className="text-xs text-coffee/55">{row.supplierProductName}</div> : null}
                    </td>
                    <td className="px-2 py-2 text-end">
                      {row.quantity} {t(unitLabelKey(row.unit))}
                    </td>
                    <td className="px-2 py-2">{row.actor || "—"}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        {row.invoiceId && onOpenInvoice ? (
                          <button type="button" className="text-turquoise" onClick={() => onOpenInvoice(row.invoiceId!)}>
                            {t("admin.inventory.source.openInvoice")}
                          </button>
                        ) : null}
                        {row.invoiceId && onEditInvoice ? (
                          <button type="button" className="text-turquoise" onClick={() => onEditInvoice(row.invoiceId!)}>
                            {t("admin.inventory.editInvoice")}
                          </button>
                        ) : null}
                        {row.fileUrl ? (
                          <a className="text-turquoise" href={row.fileUrl} target="_blank" rel="noreferrer">
                            {t("admin.inventory.source.openFile")}
                          </a>
                        ) : null}
                        {onOpenMovement ? (
                          <button type="button" className="text-turquoise" onClick={() => onOpenMovement(row.movementId)}>
                            {t("admin.inventory.source.openMovement")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminModalBody>
    </AdminModal>
  );
}
