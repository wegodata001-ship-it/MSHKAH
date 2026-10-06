"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { CheckoutProgress } from "@/components/checkout/checkout-progress";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { useCart } from "@/features/cart/cart-context";
import { formatPrice } from "@/lib/utils";

function PaymentSuccessContent() {
  const t = useT();
  const { clearCart } = useCart();
  const params = useSearchParams();
  const orderNumber = params.get("order")?.trim() || "";
  const customerName = params.get("name")?.trim() || "";
  const amountRaw = Number(params.get("amount"));
  const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return (
    <>
      <Header searchQuery="" onSearchChange={() => {}} />
      <div className="mx-auto max-w-lg px-4 py-8 md:px-6">
        <CheckoutProgress current="confirm" />
        <div className="flex flex-col items-center rounded-3xl bg-warm-white px-6 py-16 text-center shadow-soft">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-turquoise/15 text-turquoise">
            <CheckCircle2 className="h-10 w-10" strokeWidth={1.75} />
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold text-dark-brown">
            {t("checkout.paymentSuccessTitle")}
          </h1>
          <p className="mt-2 text-sm text-coffee/60">{t("checkout.paymentSuccessHint")}</p>
          <div className="mt-6 w-full space-y-2 text-sm text-coffee/75">
            {orderNumber && (
              <p>
                {t("checkout.orderNumber")}: <span className="font-semibold text-dark-brown">{orderNumber}</span>
              </p>
            )}
            {customerName && (
              <p>
                {t("checkout.name")}: <span className="font-semibold text-dark-brown">{customerName}</span>
              </p>
            )}
            {amount != null && (
              <p>
                {t("checkout.paidAmount")}: <span className="font-semibold text-dark-brown">{formatPrice(amount)}</span>
              </p>
            )}
            <p>
              {t("checkout.payment")}: {t("checkout.paymentMethodCard")}
            </p>
            <p>{t("checkout.pickupStatus")}</p>
          </div>
          <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
            <Button asChild variant="turquoise" size="lg" className="flex-1">
              <Link href="/orders">{t("checkout.backToOrder")}</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="flex-1">
              <Link href="/">{t("checkout.backToSite")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense>
      <PaymentSuccessContent />
    </Suspense>
  );
}
