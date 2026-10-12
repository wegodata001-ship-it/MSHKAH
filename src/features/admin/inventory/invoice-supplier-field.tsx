"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
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
import { unrecognizedScannedSupplier } from "@/lib/inventory/invoice-smart-match";
import type { Supplier } from "@/lib/inventory/types";
import { saveSupplier } from "@/services/inventoryService";
import { cn } from "@/lib/utils";

export function InvoiceSupplierField({
  suppliers,
  supplierId,
  supplierName,
  supplierTaxId,
  disabled,
  onSelect,
  onCreated,
}: {
  suppliers: Supplier[];
  supplierId?: string;
  supplierName?: string;
  supplierTaxId?: string;
  disabled?: boolean;
  onSelect: (supplier: Supplier | null) => void;
  onCreated?: (supplier: Supplier) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<{ name?: string; taxId?: string }>({});
  const [local, setLocal] = useState<Supplier[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...local, ...suppliers].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return item.active !== false;
    });
  }, [local, suppliers]);

  const selected = all.find((item) => item.id === supplierId);
  const unrecognized = unrecognizedScannedSupplier({ supplierId, supplierName, supplierTaxId }, all);
  const filtered = all.filter((item) => {
    const hay = `${item.name} ${item.companyName ?? ""} ${item.taxId ?? ""} ${item.phone ?? ""}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const openCreate = (prefill: { name?: string; taxId?: string } = {}) => {
    setCreatePrefill(prefill);
    setCreateOpen(true);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-start text-sm",
          disabled && "opacity-60"
        )}
      >
        <span className={selected || supplierName ? "text-dark-brown" : "text-coffee/45"}>
          {selected?.name || (unrecognized ? supplierName : null) || t("admin.inventory.noSupplier")}
        </span>
        <ChevronDown className="h-4 w-4 text-coffee/40" />
      </button>

      {open && !disabled && (
        <div className="absolute z-[80] mt-1 w-full overflow-hidden rounded-2xl border border-beige-dark/20 bg-warm-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-beige-dark/10 px-3 py-2">
            <Search className="h-4 w-4 text-coffee/40" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.inventory.searchSupplier")}
              className="h-8 w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            <button
              type="button"
              className="flex w-full px-3 py-2 text-start text-sm text-coffee/70 hover:bg-beige/50"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              {t("admin.inventory.noSupplier")}
            </button>
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full flex-col px-3 py-2 text-start hover:bg-beige/50",
                  item.id === supplierId && "bg-turquoise/10"
                )}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <span className="text-sm font-medium">{item.name}</span>
                {(item.taxId || item.phone) && (
                  <span className="text-xs text-coffee/50" dir="ltr">
                    {[item.taxId, item.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-coffee/50">{t("admin.inventory.noSupplierMatch")}</p>
            )}
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t border-beige-dark/10 px-3 py-2.5 text-sm font-medium text-turquoise hover:bg-turquoise/5"
            onClick={() => openCreate({ name: unrecognized || query || supplierName, taxId: supplierTaxId })}
          >
            <Plus className="h-4 w-4" />
            {t("admin.inventory.addNewSupplier")}
          </button>
        </div>
      )}

      {unrecognized && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{t("admin.inventory.supplierMissing").replace("{name}", unrecognized)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="turquoise" onClick={() => openCreate({ name: unrecognized, taxId: supplierTaxId })}>
              {t("admin.inventory.createMissingSupplier")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              {t("admin.inventory.chooseExistingSupplier")}
            </Button>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateSupplierFromInvoiceModal
          initialName={createPrefill.name}
          initialTaxId={createPrefill.taxId}
          onClose={() => setCreateOpen(false)}
          onCreated={(item) => {
            setLocal((current) => [item, ...current]);
            onSelect(item);
            onCreated?.(item);
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function CreateSupplierFromInvoiceModal({
  initialName,
  initialTaxId,
  onClose,
  onCreated,
}: {
  initialName?: string;
  initialTaxId?: string;
  onClose: () => void;
  onCreated: (item: Supplier) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName ?? "");
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState(initialTaxId ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AdminModal open onOpenChange={(next) => !next && onClose()} size="md">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.inventory.addNewSupplier")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>{t("admin.inventory.supplierName")} *</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.supplierCompany")}</Label>
            <Input className="mt-1" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.taxId")}</Label>
            <Input className="mt-1" value={taxId} onChange={(e) => setTaxId(e.target.value)} dir="ltr" />
          </div>
          <div>
            <Label>{t("admin.settings.phone")}</Label>
            <Input className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
          </div>
          <div>
            <Label>{t("admin.inventory.supplierEmail")}</Label>
            <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <Label>{t("admin.inventory.supplierAddress")}</Label>
            <Input className="mt-1" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.supplierContact")}</Label>
            <Input className="mt-1" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <Label>{t("admin.inventory.paymentTerms")}</Label>
            <Input className="mt-1" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>{t("admin.costing.notes")}</Label>
            <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          type="button"
          variant="turquoise"
          disabled={saving || !name.trim()}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const result = await saveSupplier({
              name,
              companyName,
              taxId,
              phone,
              email,
              address,
              contactName,
              paymentTerms,
              notes,
            });
            setSaving(false);
            if (!result.success) {
              setError(result.error);
              return;
            }
            onCreated(result.data);
          }}
        >
          {t("admin.inventory.saveAndSelectSupplier")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}

export function NoSupplierStockWarning({
  open,
  onCancel,
  onContinue,
}: {
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  if (!open) return null;
  return (
    <AdminModal open onOpenChange={(next) => !next && onCancel()} size="sm">
      <AdminModalHeader onClose={onCancel}>
        <AdminModalTitle>{t("admin.costing.supplier")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <p className="text-sm">{t("admin.inventory.noSupplierStockWarn")}</p>
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="button" variant="turquoise" onClick={onContinue}>{t("admin.inventory.continueWithoutSupplier")}</Button>
      </AdminModalFooter>
    </AdminModal>
  );
}
