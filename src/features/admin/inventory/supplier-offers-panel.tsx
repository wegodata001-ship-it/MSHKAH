"use client";

import { useState } from "react";
import { AlertTriangle, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { unitLabelKey } from "@/features/admin/costing/costing-shared";
import type { CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import {
  cheapestOffer,
  offerLastPurchaseCost,
  offerNormalizedCost,
  offerPurchaseUnit,
  offerQuoteIncludingVat,
} from "@/lib/inventory/stock";
import type { PurchasePriceRecord, Supplier, SupplierOffer, VatType } from "@/lib/inventory/types";
import { saveSupplier, saveSupplierOffer, unlinkSupplierOffer } from "@/services/inventoryService";

const UNITS: PurchaseUnit[] = ["kg", "g", "liter", "ml", "unit"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierOffersPanel({
  product,
  suppliers,
  offers,
  records,
  onToast,
}: {
  product: CostingIngredient;
  suppliers: Supplier[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const productOffers = offers.filter((offer) => offer.productId === product.id && offer.active !== false);
  const cheap = cheapestOffer(productOffers, product.baseUnit);
  const [editing, setEditing] = useState<SupplierOffer | "new" | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  return (
    <div className="space-y-3 rounded-2xl border border-beige-dark/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t("admin.inventory.supplierPrices")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
          {t("admin.inventory.addSupplierOffer")}
        </Button>
      </div>
      {!productOffers.length && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" /> {t("admin.inventory.missingSupplierWarning")}
        </p>
      )}
      {productOffers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="text-coffee/55">
                <th className="py-1 text-start">{t("admin.costing.supplier")}</th>
                <th className="py-1 text-end">{t("admin.inventory.listPrice")}</th>
                <th className="py-1 text-start">{t("admin.inventory.package")}</th>
                <th className="py-1 text-end">{t("admin.inventory.normalizedPrice")}</th>
                <th className="py-1 text-end">{t("admin.inventory.lastPaid")}</th>
                <th className="py-1 text-start">{t("admin.inventory.date")}</th>
                <th className="py-1 text-start">{t("admin.inventory.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {productOffers.map((offer) => {
                const supplier = suppliers.find((item) => item.id === offer.supplierId);
                const unit = offerPurchaseUnit(offer);
                const qty = offer.packageQuantity ?? offer.lastPackageQuantity;
                const quote = offerQuoteIncludingVat(offer);
                const normalized = offerNormalizedCost(offer);
                const lastPaid = offerLastPurchaseCost(offer);
                return (
                  <tr key={offer.id} className="border-t border-beige-dark/10">
                    <td className="py-2">
                      {supplier?.name ?? offer.supplierId}
                      {cheap?.id === offer.id && (
                        <span className="ms-2 inline-flex items-center gap-1 text-emerald-700">
                          <Trophy className="h-3 w-3" /> {t("admin.inventory.cheapest")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-end">{quote != null ? formatIls(quote) : "—"}</td>
                    <td className="py-2">{qty && unit ? `${qty}${t(unitLabelKey(unit))}` : "—"}</td>
                    <td className="py-2 text-end">
                      {normalized != null && unit ? `${formatIls(normalized, 4)}/${t(unitLabelKey(unit))}` : "—"}
                    </td>
                    <td className="py-2 text-end">{lastPaid != null ? formatIls(lastPaid, 4) : "—"}</td>
                    <td className="py-2">{(offer.lastQuotedAt || offer.lastPurchaseDate || "—").slice(5)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <button type="button" className="text-turquoise" onClick={() => setEditing(offer)}>
                          {t("common.edit")}
                        </button>
                        <button type="button" className="text-coffee/60" onClick={() => setHistoryFor(offer.supplierId)}>
                          {t("admin.inventory.priceHistory")}
                        </button>
                        <button
                          type="button"
                          className="text-red-600"
                          onClick={async () => {
                            const result = await unlinkSupplierOffer(offer.id);
                            if (result.success) onToast(t("admin.inventory.supplierUnlinked"));
                            else onToast(result.error, "error");
                          }}
                        >
                          {t("admin.inventory.unlinkSupplier")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {historyFor && (
        <div className="rounded-xl bg-beige/40 p-3 text-sm">
          <p className="mb-2 font-medium">
            {t("admin.inventory.priceHistory")} · {suppliers.find((item) => item.id === historyFor)?.name}
          </p>
          {records
            .filter((row) => row.productId === product.id && row.supplierId === historyFor)
            .slice()
            .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))
            .map((row) => (
              <p key={row.id}>
                {row.purchaseDate} · {formatIls(row.unitCost, 4)} · {row.source === "PURCHASE_INVOICE" ? t("admin.inventory.sourceInvoice") : t("admin.inventory.sourceManual")}
              </p>
            ))}
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setHistoryFor(null)}>
            {t("common.close")}
          </Button>
        </div>
      )}
      {editing && (
        <SupplierOfferModal
          product={product}
          offer={editing === "new" ? null : editing}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function SupplierOfferModal({
  product,
  offer,
  suppliers,
  onClose,
  onToast,
}: {
  product: CostingIngredient;
  offer: SupplierOffer | null;
  suppliers: Supplier[];
  onClose: () => void;
  onToast: (message: string, variant?: "success" | "error") => void;
}) {
  const t = useT();
  const [supplierId, setSupplierId] = useState(offer?.supplierId ?? "");
  const [price, setPrice] = useState(String(offer?.currentPrice ?? offer?.priceIncludingVat ?? offer?.lastPriceIncludingVat ?? ""));
  const [qty, setQty] = useState(String(offer?.packageQuantity ?? offer?.lastPackageQuantity ?? 1));
  const [unit, setUnit] = useState<PurchaseUnit>(offerPurchaseUnit(offer ?? { id: "", productId: "", supplierId: "", createdAt: "", updatedAt: "" }) ?? product.purchaseUnit);
  const [vatType, setVatType] = useState<VatType>(offer?.vatType ?? "inclusive");
  const [quotedAt, setQuotedAt] = useState(offer?.lastQuotedAt ?? todayIso());
  const [sku, setSku] = useState(offer?.supplierSku ?? "");
  const [notes, setNotes] = useState(offer?.notes ?? "");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!supplierId || !price || !qty) return;
    setSaving(true);
    const result = await saveSupplierOffer({
      productId: product.id,
      supplierId,
      currentPrice: Number(price),
      packageQuantity: Number(qty),
      purchaseUnit: unit,
      vatType,
      quotedAt,
      supplierSku: sku,
      notes,
    });
    setSaving(false);
    if (!result.success) {
      onToast(result.error, "error");
      return;
    }
    onToast(t("admin.inventory.supplierLinked"));
    onClose();
  };

  return (
    <AdminModal open onOpenChange={(next) => !next && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{offer ? t("admin.inventory.editSupplierOffer") : t("admin.inventory.addSupplierOffer")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="grid gap-3">
          <div>
            <Label>{t("admin.costing.supplier")} *</Label>
            <select className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t("admin.inventory.noSupplier")}</option>
              {suppliers.filter((item) => item.active).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <button type="button" className="mt-1 text-xs text-turquoise" onClick={() => setCreating(true)}>
              {t("admin.inventory.createSupplier")}
            </button>
          </div>
          <div>
            <Label>{t("admin.costing.purchasePrice")} *</Label>
            <Input className="mt-1" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t("admin.costing.purchaseQty")} *</Label>
              <Input className="mt-1" type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <Label>{t("admin.costing.purchaseUnit")} *</Label>
              <select className="mt-1 h-10 w-full rounded-xl border px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as PurchaseUnit)}>
                {UNITS.map((item) => (
                  <option key={item} value={item}>{t(unitLabelKey(item))}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label>{t("admin.inventory.vat")}</Label>
            <select className="mt-1 h-10 w-full rounded-xl border px-2 text-sm" value={vatType} onChange={(e) => setVatType(e.target.value as VatType)}>
              <option value="exclusive">{t("admin.inventory.vatExclusive")}</option>
              <option value="inclusive">{t("admin.inventory.vatInclusive")}</option>
              <option value="exempt">{t("admin.inventory.vatExempt")}</option>
            </select>
          </div>
          <div>
            <Label>{t("admin.inventory.quoteDate")}</Label>
            <Input className="mt-1" type="date" value={quotedAt} onChange={(e) => setQuotedAt(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.supplierSku")}</Label>
            <Input className="mt-1" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.costing.notes")}</Label>
            <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" variant="turquoise" disabled={saving || !supplierId || !price} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </AdminModalFooter>
      {creating && (
        <CreateSupplierModal
          onClose={() => setCreating(false)}
          onCreated={(item) => {
            setSupplierId(item.id);
            setCreating(false);
            onToast(t("admin.inventory.supplierSaved"));
          }}
        />
      )}
    </AdminModal>
  );
}

function CreateSupplierModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (item: Supplier) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <AdminModal open onOpenChange={(next) => !next && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.inventory.createSupplier")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="grid gap-3">
          <div>
            <Label>{t("admin.inventory.supplierName")} *</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.settings.phone")}</Label>
            <Input className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.supplierEmail")}</Label>
            <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.taxId")}</Label>
            <Input className="mt-1" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.costing.notes")}</Label>
            <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !name.trim()}
          onClick={async () => {
            setSaving(true);
            const result = await saveSupplier({ name, phone, email, taxId, notes });
            setSaving(false);
            if (result.success) onCreated(result.data);
          }}
        >
          {t("admin.inventory.saveSupplier")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}

export function recommendedSupplierLabel(
  offers: SupplierOffer[],
  suppliers: Supplier[],
  productBase?: CostingIngredient["baseUnit"]
) {
  const cheap = cheapestOffer(offers, productBase);
  if (!cheap) return null;
  const name = suppliers.find((item) => item.id === cheap.supplierId)?.name;
  const cost = offerNormalizedCost(cheap);
  return { name, cost, offer: cheap };
}
