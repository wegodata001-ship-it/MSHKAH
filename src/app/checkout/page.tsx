"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Mail,
  Phone,
  User,
  MessageSquare,
  Store,
  CheckCircle2,
  Banknote,
  CreditCard,
  ShoppingBag,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { CheckoutProgress } from "@/components/checkout/checkout-progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { useLocalizedProduct } from "@/hooks/useLocalizedContent";
import { useCart } from "@/features/cart/cart-context";
import { createOrderFromCart, getOrCreateGuestCustomer, GUEST_CUSTOMER_ID } from "@/services";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import { requestNewOrderEmailNotification, requestNewOrderPrintJob, requestCriticalCheckoutFailureNotification } from "@/lib/email/client-notify";
import { formatPrice, cn } from "@/lib/utils";
import { calculateLineTotal } from "@/lib/product-builder/engine";

function OrderLineItem({ item }: { item: import("@/types").CartItem }) {
  const localized = useLocalizedProduct(item.product);
  return (
    <div className="space-y-0.5 text-sm">
      <div className="flex justify-between">
        <span className="text-coffee/70">
          {item.quantity}× {localized.name}
        </span>
        <span>{formatPrice(calculateLineTotal(item.unitPrice, item.quantity))}</span>
      </div>
      {item.selections.map((s) => (
        <p key={`${s.groupId}-${s.optionId}`} className="ps-3 text-xs text-coffee/45">
          + {s.optionName}
        </p>
      ))}
    </div>
  );
}

export default function CheckoutPage() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const {
    items, subtotal, discount, total,
    clearCart, couponCode,
  } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [hypAvailability, setHypAvailability] = useState<"unknown" | "enabled" | "disabled">("unknown");
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/hyp/status")
      .then((res) => res.json())
      .then((data: { enabled?: boolean }) => {
        if (cancelled) return;
        setHypAvailability(data.enabled ? "enabled" : "disabled");
      })
      .catch(() => {
        if (!cancelled) setHypAvailability("disabled");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hypAvailability === "disabled" && payment === "card") setPayment("cash");
  }, [hypAvailability, payment]);

  const cardDisabled = hypAvailability === "disabled";

  if (items.length === 0 && !success) {
    return (
      <>
        <Header searchQuery="" onSearchChange={() => {}} />
        <div className="mx-auto max-w-lg px-4 py-12">
          <EmptyState
            icon={ShoppingBag}
            title={t("cart.empty")}
            description={t("cart.emptyHint")}
            actionLabel={t("cart.continueShopping")}
            actionHref="/"
          />
        </div>
      </>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) { setError(t("validation.required")); return; }
    const normalizedEmail = email.trim() ? normalizeCustomerEmail(email) : null;
    if (email.trim() && !normalizedEmail) {
      setError(t("validation.email"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      void getOrCreateGuestCustomer();

      const orderNotes = [
        notes.trim(),
        phone.trim() ? `${t("checkout.phone")}: ${phone.trim()}` : "",
        t("checkout.pickupFromStore", "איסוף עצמי מהעסק"),
      ]
        .filter(Boolean)
        .join("\n");

      let orderId = pendingOrderId;
      if (!orderId) {
        const result = await createOrderFromCart(items, GUEST_CUSTOMER_ID, name, {
          subtotal,
          discount,
          total,
          paymentMethod: payment,
          customerPhone: phone.trim(),
          customerEmail: normalizedEmail || undefined,
          notes: orderNotes || undefined,
          locale,
        });
        if (!result.success) {
          console.error("[checkout] order failed:", result.error, result.code);
          if (result.code === "ORDER_SAVE_FAILED") {
            requestCriticalCheckoutFailureNotification({
              message: result.error || "Order save failed",
              code: result.code,
            });
          }
          setError(t("checkout.orderSaveError"));
          return;
        }
        orderId = result.data.id;
      }

      if (payment === "card") {
        setPendingOrderId(orderId);
        const payRes = await fetch("/api/payments/hyp/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            customerName: name.trim(),
            customerPhone: phone.trim(),
            customerEmail: normalizedEmail || undefined,
          }),
        });
        const payData = (await payRes.json()) as { ok?: boolean; paymentUrl?: string };
        if (!payRes.ok || !payData.ok || !payData.paymentUrl) {
          setError(t("checkout.hypOpenError"));
          return;
        }
        window.location.assign(payData.paymentUrl);
        return;
      }

      requestNewOrderEmailNotification(orderId);
      requestNewOrderPrintJob(orderId);

      setSuccess(true);
      clearCart();
      setTimeout(() => router.push("/orders"), 2800);
    } catch (err) {
      console.error("[checkout] unexpected error:", err);
      requestCriticalCheckoutFailureNotification({
        message: err instanceof Error ? err.message : "Unexpected checkout failure",
        code: "CHECKOUT_UNEXPECTED",
      });
      setError(t("checkout.orderSaveError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header searchQuery="" onSearchChange={() => {}} />
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
        <CheckoutProgress current={success ? "confirm" : "details"} />

        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center rounded-3xl bg-warm-white px-6 py-16 text-center shadow-soft"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-turquoise/15 text-turquoise">
                <CheckCircle2 className="h-10 w-10" strokeWidth={1.75} />
              </div>
              <h2 className="mt-6 font-display text-2xl font-bold text-dark-brown">{t("checkout.success")}</h2>
              <p className="mt-2 text-sm text-coffee/60">{t("checkout.successHint")}</p>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h1 className="font-display text-3xl font-bold text-dark-brown">{t("checkout.title")}</h1>

              <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                  <div className="flex items-center gap-2 rounded-2xl bg-warm-white px-4 py-3 text-sm text-coffee/80 shadow-soft">
                    <Store className="h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} />
                    <span>{t("checkout.pickupFromStore", "איסוף עצמי מהעסק")}</span>
                  </div>

                  <div className="rounded-2xl bg-warm-white p-5 shadow-soft">
                    <h2 className="text-sm font-semibold">{t("checkout.details")}</h2>
                    <div className="mt-4 space-y-4">
                      <div>
                        <Label className="flex items-center gap-1"><User className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.name")}</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" required />
                      </div>
                      <div>
                        <Label className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.phone")}</Label>
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="mt-1" required />
                      </div>
                      <div>
                        <Label className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.email")}</Label>
                        <Input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          className="mt-1"
                          placeholder="name@email.com"
                        />
                      </div>
                      <div>
                        <Label className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.notes")}</Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" placeholder={t("checkout.notes")} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-warm-white p-5 shadow-soft">
                    <h2 className="text-sm font-semibold">{t("checkout.payment")}</h2>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setPayment("cash")}
                        className={cn(
                          "flex min-h-11 w-full flex-col items-start gap-1 rounded-2xl border-2 px-4 py-4 text-start transition-all",
                          payment === "cash"
                            ? "border-turquoise bg-turquoise/5"
                            : "border-beige-dark/30 bg-warm-white"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2">
                            <Banknote className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                            <span className="font-semibold">{t("checkout.paymentCash")}</span>
                          </span>
                          {payment === "cash" && (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                          )}
                        </div>
                        <span className="ps-7 text-xs text-coffee/55">{t("checkout.paymentCashHint")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!cardDisabled) setPayment("card");
                        }}
                        disabled={cardDisabled}
                        className={cn(
                          "flex min-h-11 w-full flex-col items-start gap-1 rounded-2xl border-2 px-4 py-4 text-start transition-all",
                          cardDisabled && "cursor-not-allowed opacity-55",
                          !cardDisabled && payment === "card"
                            ? "border-turquoise bg-turquoise/5"
                            : "border-beige-dark/30 bg-warm-white"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2">
                            <CreditCard className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                            <span className="font-semibold">{t("checkout.paymentCard")}</span>
                          </span>
                          {!cardDisabled && payment === "card" && (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                          )}
                        </div>
                        <span className="ps-7 text-xs text-coffee/55">{t("checkout.paymentCardHint")}</span>
                      </button>
                    </div>
                    {cardDisabled && (
                      <p className="mt-3 text-sm text-coffee/60">{t("checkout.hypUnavailable")}</p>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <div className="sticky top-24 rounded-2xl bg-warm-white p-5 shadow-soft">
                    <h2 className="text-sm font-semibold">{t("checkout.orderSummary")}</h2>
                    <div className="mt-4 space-y-2">
                      {items.map((item) => (
                        <OrderLineItem key={item.lineId} item={item} />
                      ))}
                    </div>
                    <div className="mt-4 space-y-1.5 border-t border-beige-dark/20 pt-4 text-sm">
                      <div className="flex justify-between"><span>{t("cart.subtotal")}</span><span>{formatPrice(subtotal)}</span></div>
                      {discount > 0 && (
                        <div className="flex justify-between text-emerald-600">
                          <span>{t("cart.discount")} ({couponCode})</span>
                          <span>-{formatPrice(discount)}</span>
                        </div>
                      )}
                      <p className="text-xs text-coffee/50">{t("cart.pickupOnly", "איסוף עצמי בלבד")}</p>
                      <div className="flex justify-between pt-2 text-lg font-bold">
                        <span>{t("cart.total")}</span>
                        <span className="text-turquoise">{formatPrice(total)}</span>
                      </div>
                    </div>
                    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                    <Button type="submit" variant="turquoise" size="lg" className="mt-4 w-full" disabled={loading || (payment === "card" && cardDisabled)}>
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {payment === "card" ? t("checkout.redirecting") : t("checkout.placeOrder")}
                        </span>
                      ) : payment === "card" ? (
                        t("checkout.paySecure")
                      ) : (
                        t("checkout.placeOrder")
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
