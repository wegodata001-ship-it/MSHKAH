import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import { authoritativeOrderAmount, formatHypAmount } from "@/lib/payments/hyp/amounts";
import { paymentAudit } from "@/lib/payments/hyp/audit";
import { createHypPaymentPage, verifyHypRedirect } from "@/lib/payments/hyp/client";
import { HypConfigError, isHypConfigured } from "@/lib/payments/hyp/config";
import { decidePaymentUpdate } from "@/lib/payments/hyp/decide";
import { runFailedPostPaymentTasks, runPaidPostPaymentTasks } from "@/lib/payments/hyp/pipeline";
import { hypLogFields, parseHypRedirect } from "@/lib/payments/hyp/query";
import { HYP_CURRENCY, HYP_PROVIDER } from "@/lib/payments/hyp/types";
import type { FirestoreOrder } from "@/types/firestore";

export class HypPaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "HypPaymentError";
  }
}

function pageLangFromLocale(locale?: string): "HEB" | "ENG" {
  return locale === "en" ? "ENG" : "HEB";
}

async function trustedChargeAmount(order: FirestoreOrder): Promise<number> {
  const items = order.items ?? [];
  if (items.length === 0) {
    throw new HypPaymentError("Order has no items", "INVALID_AMOUNT", 400);
  }
  const db = getAdminDb();
  let catalogSum = 0;
  for (const item of items) {
    const productId = item.productId?.trim();
    if (!productId) {
      throw new HypPaymentError("Order items are invalid", "INVALID_AMOUNT", 400);
    }
    const snap = await db.collection(COLLECTIONS.products).doc(productId).get();
    if (!snap.exists) {
      throw new HypPaymentError("Order items are invalid", "INVALID_AMOUNT", 400);
    }
    const catalogPrice = Number(snap.data()?.price);
    if (!Number.isFinite(catalogPrice) || catalogPrice < 0) {
      throw new HypPaymentError("Order amount is invalid", "INVALID_AMOUNT", 400);
    }
    const stored = Number(item.price) || 0;
    const base = Number(item.basePrice);
    const extras = Number.isFinite(base) ? Math.max(0, stored - base) : 0;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) {
      throw new HypPaymentError("Order items are invalid", "INVALID_AMOUNT", 400);
    }
    catalogSum += (catalogPrice + extras) * qty;
  }
  const discount = Number(order.discount) || 0;
  const delivery = Number(order.delivery) || 0;
  return Math.max(Math.round((catalogSum - discount + delivery) * 100) / 100, 0);
}

export async function createHypPaymentAttempt(
  orderId: string,
  customer?: { name?: string; phone?: string; email?: string }
): Promise<{
  paymentId: string;
  paymentUrl: string;
}> {
  if (!isHypConfigured()) {
    throw new HypConfigError();
  }

  const id = orderId.trim();
  if (!id) {
    throw new HypPaymentError("orderId required", "ORDER_REQUIRED", 400);
  }

  const db = getAdminDb();
  const orderRef = db.collection(COLLECTIONS.orders).doc(id);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HypPaymentError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  let order = orderSnap.data() as FirestoreOrder;
  if (order.status === "cancelled") {
    throw new HypPaymentError("Order cannot be paid", "ORDER_CANCELLED", 409);
  }
  if (order.paymentStatus === "paid") {
    throw new HypPaymentError("Order is already paid", "ALREADY_PAID", 409);
  }

  const customerPatch: Record<string, string> = {};
  const nextName = customer?.name?.trim();
  const nextPhone = customer?.phone?.trim();
  const nextEmail = normalizeCustomerEmail(customer?.email);
  if (nextName) customerPatch.customerName = nextName;
  if (nextPhone) customerPatch.customerPhone = nextPhone;
  if (nextEmail) customerPatch.customerEmail = nextEmail;
  if (Object.keys(customerPatch).length > 0) {
    await orderRef.update(customerPatch);
    order = { ...order, ...customerPatch };
  }

  const amount = await trustedChargeAmount(order);
  if (amount <= 0) {
    throw new HypPaymentError("Order amount is invalid", "INVALID_AMOUNT", 400);
  }
  if (amount !== authoritativeOrderAmount(order) || amount !== order.total) {
    await orderRef.update({ total: amount, subtotal: amount + (order.discount ?? 0) });
  }

  const customerEmail = normalizeCustomerEmail(order.customerEmail);
  const paymentRef = db.collection(COLLECTIONS.payments).doc();
  const now = FieldValue.serverTimestamp();
  await paymentRef.set({
    orderId: id,
    orderNumber: order.orderNumber,
    provider: HYP_PROVIDER,
    amount,
    expectedAmount: amount,
    currency: HYP_CURRENCY,
    status: "pending",
    customerEmail: customerEmail || null,
    createdAt: now,
    updatedAt: now,
  });

  await orderRef.update({
    paymentMethod: "card",
    paymentStatus: "pending",
    paymentProvider: HYP_PROVIDER,
  });
  paymentAudit("PAYMENT_CREATED", { orderId: id, paymentAttemptId: paymentRef.id });

  try {
    const paymentUrl = await createHypPaymentPage({
      amount: formatHypAmount(amount),
      orderRef: paymentRef.id,
      info: `Mishkat ${order.orderNumber}`,
      clientName: order.customerName?.trim() || undefined,
      cell: order.customerPhone?.trim() || undefined,
      email: customerEmail || undefined,
      pageLang: pageLangFromLocale(order.locale),
    });
    paymentAudit("HYP_REDIRECT_CREATED", { orderId: id, paymentAttemptId: paymentRef.id });
    return { paymentId: paymentRef.id, paymentUrl };
  } catch (error) {
    await paymentRef.update({
      status: "failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.error(
      "[hyp] create failed",
      hypLogFields({
        orderId: id,
        paymentAttemptId: paymentRef.id,
        providerErrorCode:
          error instanceof Error ? error.message.replace(/^HYP_SIGN_FAILED:/, "") : "sign_failed",
      })
    );
    throw new HypPaymentError(
      "Could not open the secure payment page",
      "HYP_UNAVAILABLE",
      502
    );
  }
}

export async function handleHypReturn(rawQuery: string): Promise<{
  redirectPath: string;
}> {
  const redirect = parseHypRedirect(rawQuery);
  const paymentId = redirect.order.trim();

  if (!paymentId) {
    return { redirectPath: "/payment/failed?reason=cancelled" };
  }

  const db = getAdminDb();
  const paymentRef = db.collection(COLLECTIONS.payments).doc(paymentId);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    console.error(
      "[hyp] return unknown payment",
      hypLogFields({
        paymentAttemptId: paymentId,
        providerErrorCode: redirect.cCode || "unknown_payment",
      })
    );
    return { redirectPath: "/payment/failed?reason=failed" };
  }

  const payment = paymentSnap.data() as {
    orderId: string;
    orderNumber?: string;
    amount: number;
    status: string;
    hypTransactionId?: string;
  };

  const orderRef = db.collection(COLLECTIONS.orders).doc(payment.orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    return { redirectPath: `/payment/failed?orderId=${encodeURIComponent(payment.orderId)}&reason=failed` };
  }

  const order = orderSnap.data() as FirestoreOrder;
  const failedPath = `/payment/failed?orderId=${encodeURIComponent(payment.orderId)}&order=${encodeURIComponent(order.orderNumber)}`;
  const successParams = new URLSearchParams({
    order: order.orderNumber,
    amount: formatHypAmount(payment.amount),
  });
  if (order.customerName?.trim()) successParams.set("name", order.customerName.trim());
  const successPath = `/payment/success?${successParams.toString()}`;
  paymentAudit("HYP_RETURN_RECEIVED", {
    orderId: payment.orderId,
    paymentAttemptId: paymentId,
    extra: { cCode: redirect.cCode },
  });

  let verified = false;
  let verifyCode = "";
  if (rawQuery.trim()) {
    try {
      const result = await verifyHypRedirect(rawQuery);
      verified = result.ok;
      verifyCode = result.cCode;
      paymentAudit(result.ok ? "HYP_VERIFY_SUCCESS" : "HYP_VERIFY_FAILED", {
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
        extra: { verifyCode: result.cCode },
      });
    } catch (error) {
      console.error(
        "[hyp] verify failed",
        hypLogFields({
          orderId: payment.orderId,
          paymentAttemptId: paymentId,
          providerErrorCode: error instanceof Error ? error.message : "verify_failed",
        })
      );
      verified = false;
    }
  }

  const decision = decidePaymentUpdate({
    order: {
      id: payment.orderId,
      total: authoritativeOrderAmount(order),
      status: order.status,
      paymentStatus: order.paymentStatus,
    },
    payment: {
      id: paymentId,
      orderId: payment.orderId,
      amount: payment.amount,
      status: payment.status,
      hypTransactionId: payment.hypTransactionId,
    },
    verified,
    resultCCode: redirect.cCode,
    returnedAmount: redirect.amount,
    returnedOrder: redirect.order,
    returnedCoin: redirect.coin || undefined,
    transactionId: redirect.id,
  });

  if (decision.action === "already_processed") {
    if (decision.outcome === "paid") {
      void runPaidPostPaymentTasks(payment.orderId, paymentId);
    }
    return {
      redirectPath: decision.outcome === "paid" ? successPath : `${failedPath}&reason=${decision.outcome}`,
    };
  }

  if (decision.action === "reject") {
    console.error(
      "[hyp] return rejected",
      hypLogFields({
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
        providerErrorCode: decision.reason,
        extra: { verifyCode, resultCCode: redirect.cCode },
      })
    );
    if (
      decision.reason !== "verify_failed" &&
      payment.status !== "paid" &&
      order.paymentStatus !== "paid"
    ) {
      await paymentRef.update({
        status: "failed",
        lastCCode: redirect.cCode || decision.reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { redirectPath: `${failedPath}&reason=failed` };
  }

  const alreadyPaid = await db.runTransaction(async (tx) => {
    const livePayment = await tx.get(paymentRef);
    const liveOrder = await tx.get(orderRef);
    const livePaymentData = livePayment.data();
    const liveOrderData = liveOrder.data() as FirestoreOrder | undefined;
    if (!livePaymentData || !liveOrderData) return false;

    if (liveOrderData.paymentStatus === "paid" || livePaymentData.status === "paid") {
      return true;
    }

    const now = FieldValue.serverTimestamp();

    if (decision.action === "mark_paid") {
      const paidPatch: Record<string, unknown> = {
        status: "paid",
        hypTransactionId: redirect.id,
        providerReference: redirect.id,
        lastCCode: redirect.cCode,
        verifiedAt: now,
        paidAt: now,
        updatedAt: now,
      };
      if (redirect.aCode) paidPatch.approvalCode = redirect.aCode;
      tx.update(paymentRef, paidPatch);
      tx.update(orderRef, {
        paymentStatus: "paid",
        paymentMethod: "card",
        paymentProvider: HYP_PROVIDER,
        paymentTransactionId: redirect.id,
      });
      return false;
    }

    const nextStatus = decision.action === "mark_cancelled" ? "cancelled" : "failed";
    tx.update(paymentRef, {
      status: nextStatus,
      lastCCode: redirect.cCode || verifyCode,
      updatedAt: now,
    });
    tx.update(orderRef, {
      paymentStatus: nextStatus === "cancelled" ? "pending" : "failed",
    });
    return false;
  });

  if (decision.action === "mark_paid") {
    if (!alreadyPaid) {
      paymentAudit("PAYMENT_CONFIRMED", {
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
      });
      paymentAudit("ORDER_CONFIRMED", {
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
      });
    }
    void runPaidPostPaymentTasks(payment.orderId, paymentId);
    return { redirectPath: successPath };
  }

  if (!alreadyPaid && (decision.action === "mark_failed" || decision.action === "mark_cancelled")) {
    void runFailedPostPaymentTasks(payment.orderId, paymentId);
  }

  return {
    redirectPath: `${failedPath}&reason=${decision.action === "mark_cancelled" ? "cancelled" : "failed"}`,
  };
}
