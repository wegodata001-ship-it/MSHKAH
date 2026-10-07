"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderCard } from "@/features/admin/orders/order-card";
import { useT } from "@/components/providers/locale-provider";
import type { Order, OrderStatus } from "@/types";

export function KitchenView({
  open,
  orders,
  now,
  updatingIds,
  onClose,
  onStatusChange,
  onCancel,
  onPrint,
  onThermalReprint,
}: {
  open: boolean;
  orders: Order[];
  now?: number;
  updatingIds: Set<string>;
  onClose: () => void;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onCancel: (order: Order) => void;
  onPrint: (order: Order) => void;
  onThermalReprint?: (order: Order) => void;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[900] flex h-[100dvh] flex-col overflow-hidden bg-cream dark:bg-[#120e0c]">
      <header className="flex shrink-0 items-center justify-between border-b border-beige-dark/20 bg-warm-white px-4 py-3 sm:px-6 dark:bg-[#1a1412]">
        <div>
          <h1 className="font-display text-xl font-bold sm:text-2xl">{t("admin.orders.kitchenTitle")}</h1>
          <p className="text-sm text-coffee/55">
            {orders.length} {t("admin.orders.activeOrders")}
          </p>
        </div>
        <Button type="button" variant="outline" size="icon" onClick={onClose} aria-label={t("common.close")}>
          <X className="h-5 w-5" />
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {orders.length === 0 ? (
          <div className="grid min-h-[50dvh] place-items-center text-coffee/55">
            {t("admin.orders.noActive")}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1800px] gap-4 md:grid-cols-2 xl:grid-cols-3">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                expanded
                now={now}
                updating={updatingIds.has(order.id)}
                onToggle={() => {}}
                onStatusChange={(status) => onStatusChange(order, status)}
                onCancel={() => onCancel(order)}
                onPrint={() => onPrint(order)}
                onThermalReprint={onThermalReprint ? () => onThermalReprint(order) : undefined}
              />
            ))}
          </div>
        )}
      </main>
    </div>,
    document.body
  );
}
