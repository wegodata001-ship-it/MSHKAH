"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminModal, AdminModalBody, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { InvoiceCategorySelect } from "@/features/admin/inventory/invoice-category-select";
import { InvoiceUnitField } from "@/features/admin/inventory/invoice-unit-field";
import { useT } from "@/components/providers/locale-provider";
import { findDuplicateIngredient } from "@/lib/costing/names";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { createIngredient } from "@/services/costingService";

export function InvoiceNewProductDialog({
  open,
  supplierName,
  existing,
  onClose,
  onCreated,
}: {
  open: boolean;
  supplierName: string;
  existing: CostingIngredient[];
  onClose: () => void;
  onCreated: (item: CostingIngredient) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unit, setUnit] = useState<PurchaseUnit>("unit");
  const [packCount, setPackCount] = useState<number | null>(null);
  const [packContentUnit, setPackContentUnit] = useState<PurchaseUnit | null>(null);
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [barcode, setBarcode] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCategory("");
    setCategoryId("");
    setUnit("unit");
    setPackCount(null);
    setPackContentUnit(null);
    setPrice("");
    setQuantity("1");
    setBarcode("");
    setNote("");
    setError(null);
  }, [open]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    const duplicate = findDuplicateIngredient(trimmed, existing);
    if (duplicate) {
      onCreated(duplicate);
      onClose();
      return;
    }
    setSaving(true);
    const result = await createIngredient({
      name: trimmed,
      category,
      categoryId,
      purchasePrice: price ? Number(price) : 0,
      purchaseQuantity: quantity ? Number(quantity) : 1,
      purchaseUnit: unit,
      packCount: packCount ?? undefined,
      packContentUnit: packContentUnit ?? undefined,
      supplier: supplierName,
      barcode,
      notes: note,
      originKind: "invoice",
    });
    setSaving(false);
    if (!result.success) {
      setError(t("admin.costing.saveFailed"));
      return;
    }
    onCreated(result.data);
    onClose();
  };

  return (
    <AdminModal open={open} onOpenChange={(next) => !next && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.invoice.manual.newProduct")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody className="space-y-2">
        <Input className="h-11" value={name} placeholder={t("admin.inventory.product")} onChange={(event) => setName(event.target.value)} />
        <InvoiceCategorySelect value={category} onChange={(next) => { setCategory(next.name); setCategoryId(next.id); }} />
        <InvoiceUnitField
          unit={unit}
          packCount={packCount}
          packContentUnit={packContentUnit}
          quantity={quantity ? Number(quantity) : 1}
          lineTotal={price ? Number(price) : 0}
          onChange={(patch) => {
            setUnit(patch.unit ?? "unit");
            setPackCount(patch.packCount);
            setPackContentUnit(patch.packContentUnit);
          }}
        />
        <Input className="h-11" value={supplierName} disabled placeholder={t("admin.costing.supplier")} />
        <div className="grid grid-cols-2 gap-2">
          <Input className="h-11" type="number" min="0" value={price} placeholder={t("admin.inventory.unitPrice")} onChange={(event) => setPrice(event.target.value)} />
          <Input className="h-11" type="number" min="0" value={quantity} placeholder={t("admin.inventory.qty")} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <Input className="h-11" value={barcode} placeholder={`${t("admin.invoice.manual.barcode")} (${t("admin.invoice.manual.optional")})`} onChange={(event) => setBarcode(event.target.value)} />
        <Input className="h-11" value={note} placeholder={`${t("admin.invoice.manual.note")} (${t("admin.invoice.manual.optional")})`} onChange={(event) => setNote(event.target.value)} />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <Button type="button" variant="turquoise" className="min-h-11 w-full" disabled={saving || !name.trim()} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("admin.invoice.manual.saveCategory")}
        </Button>
      </AdminModalBody>
    </AdminModal>
  );
}
