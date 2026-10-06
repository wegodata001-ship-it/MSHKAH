export const HYP_PROVIDER = "HYP" as const;

export const HYP_API_BASE = "https://pay.hyp.co.il/p/";

export const HYP_CURRENCY = "ILS" as const;

/** Existing order payment statuses — do not invent a parallel model. */
export type OrderPaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type HypPaymentStatus = "pending" | "paid" | "failed" | "cancelled";

export type HypConfig = {
  masof: string;
  apiKey: string;
  passP: string;
  environment: string;
};

export type HypSignRequest = {
  amount: string;
  orderRef: string;
  clientName?: string;
  cell?: string;
  /** Official APISign customer-email prefill (lowercase `email`). Not Fild1/Fild2. */
  email?: string;
  info?: string;
  pageLang: "HEB" | "ENG";
};

export type HypRedirectParams = {
  rawQuery: string;
  pairs: Array<{ key: string; value: string }>;
  id: string;
  cCode: string;
  amount: string;
  aCode: string;
  order: string;
  coin: string;
  sign: string;
};

export type PaymentDecision =
  | { action: "already_processed"; outcome: "paid" | "failed" | "cancelled" }
  | { action: "reject"; reason: string }
  | { action: "mark_paid" }
  | { action: "mark_failed" }
  | { action: "mark_cancelled" };
