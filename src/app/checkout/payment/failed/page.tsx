"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { CheckoutProgress } from "@/components/checkout/checkout-progress";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";

function PaymentFailedContent() {
  const t = useT();
  const params = useSearchParams();
  const orderId = params.get("orderId")?.trim() || "";
  const orderNumber = params.get("order")?.trim() || "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    if (!orderId) {
      window.location.assign("/checkout");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/payments/hyp/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = (await response.json()) as { ok?: boolean; paymentUrl?: string };
      if (!response.ok || !data.ok || !data.paymentUrl) {
        setError(t("checkout.hypOpenError"));
        return;
      }
      window.location.assign(data.paymentUrl);
    } catch {
      setError(t("checkout.hypOpenError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header searchQuery="" onSearchChange={() => {}} />
      <div className="mx-auto max-w-lg px-4 py-8 md:px-6">
        <CheckoutProgress current="payment" />
        <div className="flex flex-col items-center rounded-3xl bg-warm-white px-6 py-16 text-center shadow-soft">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-600">
            <CircleAlert className="h-10 w-10" strokeWidth={1.75} />
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold text-dark-brown">
            {t("checkout.paymentFailedTitle")}
          </h1>
          <p className="mt-2 text-sm text-coffee/60">{t("checkout.paymentFailedHint")}</p>
          {orderNumber && (
            <p className="mt-2 text-sm text-coffee/60">
              {t("checkout.orderNumber")}: {orderNumber}
            </p>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
            <Button variant="turquoise" size="lg" className="flex-1" onClick={retry} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("checkout.retryPayment")}
            </Button>
            <Button asChild variant="outline" size="lg" className="flex-1">
              <Link href="/cart">{t("checkout.backToCart")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function PaymentFailedPage() {
  return (
    <Suspense>
      <PaymentFailedContent />
    </Suspense>
  );
}
