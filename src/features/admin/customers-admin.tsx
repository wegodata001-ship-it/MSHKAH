"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Loader2, User, ShoppingBag, Heart, StickyNote } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCustomers } from "@/hooks/useCustomers";
import { useOrders } from "@/hooks/useOrders";
import { useClubMembers } from "@/hooks/useClubMembers";
import { ClubMemberBadge } from "@/features/admin/club-member-badge";
import { createCustomer, updateCustomer, deleteCustomer } from "@/services";
import { customerSchema, type CustomerInput } from "@/lib/validation/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { Badge } from "@/components/ui/badge";
import { getInitials, formatDateShort, formatPrice } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";
import { AdminPageHeader } from "./components/admin-page-header";
import type { Customer, OrderStatus } from "@/types";

export function CustomersAdmin() {
  const t = useT();
  const { customers, loading } = useCustomers();
  const { orders } = useOrders();
  const { byEmail: membersByEmail } = useClubMembers();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [profile, setProfile] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyMembers, setOnlyMembers] = useState(false);

  // Resolve club membership once per render for every row; cheap because
  // `membersByEmail` is a Map keyed on lower-cased email.
  const customerIsMember = (customer: Customer) => {
    const email = customer.email?.trim().toLowerCase();
    if (!email) return undefined;
    const member = membersByEmail.get(email);
    return member?.status === "active" ? member : undefined;
  };

  const visibleCustomers = onlyMembers
    ? customers.filter((customer) => Boolean(customerIsMember(customer)))
    : customers;

  const statusLabel = (status: OrderStatus) => t(`admin.status.${status}`);

  const form = useForm({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: "", phone: "", email: "", address: "", favoriteProducts: [], notes: "" },
  });

  const customerOrders = useMemo(() => {
    if (!profile) return [];
    return orders.filter((o) => o.customerId === profile.id);
  }, [orders, profile]);

  const totalSpending = useMemo(() => {
    if (!profile) return 0;
    return customerOrders.reduce((s, o) => s + o.total, 0);
  }, [customerOrders, profile]);

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", phone: "", email: "", address: "", favoriteProducts: [], notes: "" });
    setError(null);
    setOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    form.reset({
      name: customer.name,
      phone: customer.phone,
      email: "",
      address: customer.address,
      favoriteProducts: customer.favoriteItems,
      notes: customer.notes,
    });
    setError(null);
    setOpen(true);
  };

  const onSubmit = form.handleSubmit(async (data) => {
    setSaving(true);
    setError(null);
    const result = editing
      ? await updateCustomer(editing.id, data)
      : await createCustomer(data);
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
  });

  const handleDelete = async (id: string) => {
    if (!confirm(t("admin.customers.deleteConfirm"))) return;
    await deleteCustomer(id);
    if (profile?.id === id) setProfile(null);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("admin.customers.title")}
        subtitle={t("admin.customers.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-xl border border-beige-dark/30 bg-warm-white px-2.5 py-1.5 text-xs text-coffee/80 dark:bg-white/5 dark:text-warm-white/80">
              <input
                type="checkbox"
                checked={onlyMembers}
                onChange={(event) => setOnlyMembers(event.target.checked)}
              />
              {t("admin.customers.clubFilter")}
            </label>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("admin.customers.new")}
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-beige-dark/20 bg-warm-white shadow-soft dark:border-white/10 dark:bg-white/5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-beige-dark/20 bg-beige/30 text-left text-xs uppercase tracking-wider text-coffee/60 dark:bg-white/5">
                  <th className="px-4 py-3">{t("admin.customers.name")}</th>
                  <th className="hidden px-4 py-3 md:table-cell">{t("admin.customers.phone")}</th>
                  <th className="px-4 py-3">{t("admin.customers.orders")}</th>
                  <th className="hidden px-4 py-3 sm:table-cell">{t("admin.customers.spending")}</th>
                  <th className="hidden px-4 py-3 lg:table-cell">{t("admin.customers.lastVisit")}</th>
                  <th className="px-4 py-3 text-right">{t("admin.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleCustomers.map((customer, i) => (
                  <motion.tr
                    key={customer.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="border-b border-beige-dark/10 hover:bg-beige/20 dark:hover:bg-white/5"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setProfile(customer)}
                        className="flex items-center gap-3 text-left"
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-beige text-coffee text-xs">
                            {getInitials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-dark-brown dark:text-warm-white">{customer.name}</p>
                            {customerIsMember(customer) ? <ClubMemberBadge compact /> : null}
                          </div>
                          <p className="text-xs text-coffee/50 md:hidden">{customer.phone}</p>
                        </div>
                      </button>
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-coffee/60 md:table-cell">{customer.phone}</td>
                    <td className="px-4 py-3 text-sm font-medium text-coffee">{customer.ordersCount}</td>
                    <td className="hidden px-4 py-3 text-sm text-coffee sm:table-cell">
                      {formatPrice(customer.totalSpending || totalSpendingFor(customer, orders))}
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-coffee/50 lg:table-cell">
                      {formatDateShort(customer.lastOrder)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setProfile(customer)} title={t("admin.action.view")}>
                          <User className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => openEdit(customer)} title={t("admin.action.edit")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(customer.id)} title={t("admin.action.delete")}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AdminModal open={!!profile} onOpenChange={(v) => !v && setProfile(null)} size="sm">
          {profile && (
            <>
              <AdminModalHeader onClose={() => setProfile(null)}>
                <AdminModalTitle className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{getInitials(profile.name)}</AvatarFallback>
                  </Avatar>
                  {profile.name}
                </AdminModalTitle>
              </AdminModalHeader>
              <AdminModalBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-beige/30 p-3 dark:bg-white/5">
                  <p className="text-xs text-coffee/50">{t("admin.customers.totalOrders")}</p>
                  <p className="text-xl font-bold text-dark-brown dark:text-warm-white">{profile.ordersCount}</p>
                </div>
                <div className="rounded-xl bg-beige/30 p-3 dark:bg-white/5">
                  <p className="text-xs text-coffee/50">{t("admin.customers.totalSpending")}</p>
                  <p className="text-xl font-bold text-coffee">{formatPrice(totalSpending || profile.totalSpending)}</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p><span className="text-coffee/50">{t("admin.customers.phone")}:</span> {profile.phone}</p>
                <p><span className="text-coffee/50">{t("admin.customers.address")}:</span> {profile.address}</p>
                <p><span className="text-coffee/50">{t("admin.customers.lastVisit")}:</span> {formatDateShort(profile.lastOrder)}</p>
              </div>
              {profile.favoriteItems.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-coffee/50">
                    <Heart className="h-3.5 w-3.5" /> {t("admin.customers.favoriteProducts")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {profile.favoriteItems.map((item) => (
                      <Badge key={item} variant="outline">{item}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {profile.notes && (
                <div className="rounded-xl bg-beige/20 p-3 dark:bg-white/5">
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-coffee/50">
                    <StickyNote className="h-3.5 w-3.5" /> {t("admin.customers.notes")}
                  </p>
                  <p className="text-sm">{profile.notes}</p>
                </div>
              )}
              <div>
                <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-coffee/50">
                  <ShoppingBag className="h-3.5 w-3.5" /> {t("admin.customers.orderHistory")}
                </p>
                {customerOrders.length === 0 ? (
                  <p className="text-sm text-coffee/50">{t("admin.dashboard.noOrders")}</p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {customerOrders.map((order) => (
                      <div key={order.id} className="flex items-center justify-between rounded-lg border border-beige-dark/20 px-3 py-2 text-sm dark:border-white/10">
                        <div>
                          <p className="font-medium">{order.orderNumber}</p>
                          <p className="text-xs text-coffee/50">{formatDateShort(order.createdAt)}</p>
                        </div>
                        <Badge variant={order.status as "pending"}>{statusLabel(order.status)}</Badge>
                        <span className="font-semibold text-coffee">{formatPrice(order.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </AdminModalBody>
            </>
          )}
      </AdminModal>

      <AdminModal open={open} onOpenChange={setOpen} size="sm">
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminModalHeader onClose={() => setOpen(false)}>
            <AdminModalTitle>{editing ? t("admin.customers.edit") : t("admin.customers.new")}</AdminModalTitle>
          </AdminModalHeader>
          <AdminModalBody className="space-y-4">
            <div>
              <Label htmlFor="name">{t("admin.customers.name")}</Label>
              <Input id="name" {...form.register("name")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="phone">{t("admin.customers.phone")}</Label>
              <Input id="phone" {...form.register("phone")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="email">{t("admin.email")}</Label>
              <Input id="email" type="email" {...form.register("email")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="address">{t("admin.customers.address")}</Label>
              <Input id="address" {...form.register("address")} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="notes">{t("admin.customers.notes")}</Label>
              <Textarea id="notes" {...form.register("notes")} className="mt-1" rows={3} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </AdminModalBody>
          <AdminModalFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("admin.action.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? t("admin.action.save") : t("admin.action.create")}
            </Button>
          </AdminModalFooter>
          </form>
      </AdminModal>
    </div>
  );
}

function totalSpendingFor(customer: Customer, orders: { customerId: string; total: number }[]) {
  return orders.filter((o) => o.customerId === customer.id).reduce((s, o) => s + o.total, 0);
}
