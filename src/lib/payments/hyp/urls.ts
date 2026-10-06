import { getPublicStoreOrigin } from "@/lib/domains/host-routing";

export function getPaymentPublicOrigin(): string {
  return getPublicStoreOrigin();
}

/** HYP terminal Success / Fail / Return URL must point here. */
export function getHypReturnUrl(): string {
  return `${getPaymentPublicOrigin()}/api/payments/hyp/return`;
}

export function getPaymentSuccessPath(input: {
  orderNumber: string;
  amount: string;
}): string {
  const params = new URLSearchParams({
    order: input.orderNumber,
    amount: input.amount,
  });
  return `/payment/success?${params.toString()}`;
}

export function getPaymentFailedPath(input: {
  orderId: string;
  orderNumber?: string;
  reason?: "cancelled" | "failed";
}): string {
  const params = new URLSearchParams({ orderId: input.orderId });
  if (input.orderNumber) params.set("order", input.orderNumber);
  if (input.reason) params.set("reason", input.reason);
  return `/payment/failed?${params.toString()}`;
}

export function getPaymentSuccessUrl(input: {
  orderNumber: string;
  amount: string;
}): string {
  return `${getPaymentPublicOrigin()}${getPaymentSuccessPath(input)}`;
}

export function getPaymentFailedUrl(input: {
  orderId: string;
  orderNumber?: string;
  reason?: "cancelled" | "failed";
}): string {
  return `${getPaymentPublicOrigin()}${getPaymentFailedPath(input)}`;
}
