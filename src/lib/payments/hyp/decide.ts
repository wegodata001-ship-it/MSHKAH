import { amountsMatch } from "@/lib/payments/hyp/amounts";
import { isHypSuccessCCode } from "@/lib/payments/hyp/query";
import type { PaymentDecision } from "@/lib/payments/hyp/types";

export type DecisionInput = {
  order: {
    id: string;
    total: number;
    status: string;
    paymentStatus?: string;
  };
  payment: {
    id: string;
    orderId: string;
    amount: number;
    status: string;
    hypTransactionId?: string;
  };
  verified: boolean;
  resultCCode: string;
  returnedAmount: string;
  returnedOrder: string;
  returnedCoin?: string;
  transactionId: string;
};

export function decidePaymentUpdate(input: DecisionInput): PaymentDecision {
  const { order, payment } = input;

  if (order.status === "cancelled") {
    return { action: "reject", reason: "order_cancelled" };
  }

  if (order.paymentStatus === "paid" || payment.status === "paid") {
    return { action: "already_processed", outcome: "paid" };
  }

  if (payment.status === "failed") {
    if (!input.verified || !isHypSuccessCCode(input.resultCCode)) {
      return { action: "already_processed", outcome: "failed" };
    }
  }

  if (payment.status === "cancelled" && !isHypSuccessCCode(input.resultCCode)) {
    return { action: "already_processed", outcome: "cancelled" };
  }

  if (!input.verified) {
    return { action: "reject", reason: "verify_failed" };
  }

  if (!isHypSuccessCCode(input.resultCCode)) {
    if (!input.transactionId) return { action: "mark_cancelled" };
    return { action: "mark_failed" };
  }

  if (input.returnedOrder && input.returnedOrder !== payment.id) {
    return { action: "reject", reason: "order_mismatch" };
  }

  if (!amountsMatch(payment.amount, input.returnedAmount) && !amountsMatch(order.total, input.returnedAmount)) {
    return { action: "reject", reason: "amount_mismatch" };
  }

  if (input.returnedCoin && input.returnedCoin !== "1") {
    return { action: "reject", reason: "currency_mismatch" };
  }

  if (!input.transactionId) {
    return { action: "reject", reason: "missing_transaction_id" };
  }

  return { action: "mark_paid" };
}
