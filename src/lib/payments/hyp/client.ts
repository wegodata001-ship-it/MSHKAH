import { getHypApiBase, getHypConfig } from "@/lib/payments/hyp/config";
import { splitHypCustomerName } from "@/lib/payments/hyp/names";
import {
  hypLogFields,
  isHypSuccessCCode,
  parseHypResponseBody,
} from "@/lib/payments/hyp/query";
import type { HypSignRequest } from "@/lib/payments/hyp/types";

/** Documented APISign SIGN fields for this hosted flow. Identity is `Order`, not Fild*. */
export function applyHypCustomerParams(
  params: URLSearchParams,
  request: HypSignRequest
): URLSearchParams {
  params.set("Amount", request.amount);
  params.set("Coin", "1");
  params.set("Order", request.orderRef);
  params.set("PageLang", request.pageLang);
  params.set("UTF8", "True");
  params.set("UTF8out", "True");
  if (request.info) params.set("Info", request.info);
  if (request.clientName) {
    const { firstName, lastName } = splitHypCustomerName(request.clientName);
    if (firstName) params.set("ClientName", firstName);
    if (lastName) params.set("ClientLName", lastName);
  }
  if (request.cell) {
    params.set("cell", request.cell);
    params.set("phone", request.cell);
  }
  if (request.email) params.set("email", request.email.trim().toLowerCase());
  return params;
}

async function hypGet(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    headers: { Accept: "text/plain,*/*" },
  });
  return response.text();
}

/**
 * Official flow: GET action=APISign&What=SIGN…
 * Response is a query string. Append it unchanged to https://pay.hyp.co.il/p/?
 */
export async function createHypPaymentPage(request: HypSignRequest): Promise<string> {
  const config = getHypConfig();
  const url = new URL(getHypApiBase());
  url.searchParams.set("action", "APISign");
  url.searchParams.set("What", "SIGN");
  url.searchParams.set("Sign", "True");
  url.searchParams.set("KEY", config.apiKey);
  url.searchParams.set("PassP", config.passP);
  url.searchParams.set("Masof", config.masof);
  applyHypCustomerParams(url.searchParams, request);

  const body = await hypGet(url.toString());
  const parsed = parseHypResponseBody(body);

  if (parsed.CCode && parsed.CCode !== "0") {
    console.error(
      "[hyp] sign failed",
      hypLogFields({
        paymentAttemptId: request.orderRef,
        providerErrorCode: parsed.CCode,
      })
    );
    throw new Error(`HYP_SIGN_FAILED:${parsed.CCode}`);
  }

  const signedQuery = body.trim();
  if (!signedQuery || signedQuery.startsWith("<") || !signedQuery.includes("signature=")) {
    console.error(
      "[hyp] sign failed",
      hypLogFields({
        paymentAttemptId: request.orderRef,
        providerErrorCode: "invalid_sign_response",
      })
    );
    throw new Error("HYP_SIGN_FAILED:invalid_response");
  }

  return `${getHypApiBase()}?${signedQuery}`;
}

/**
 * Official VERIFY: resend every redirect parameter in the same order
 * after action=APISign&What=VERIFY&Masof&KEY&PassP.
 */
export async function verifyHypRedirect(rawQuery: string): Promise<{
  ok: boolean;
  cCode: string;
}> {
  const config = getHypConfig();
  const redirectQuery = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  const prefix = new URLSearchParams({
    action: "APISign",
    What: "VERIFY",
    Masof: config.masof,
    KEY: config.apiKey,
    PassP: config.passP,
  });
  const url = `${getHypApiBase()}?${prefix.toString()}&${redirectQuery}`;

  const body = await hypGet(url);
  const parsed = parseHypResponseBody(body);
  const cCode = parsed.CCode ?? "";
  return { ok: isHypSuccessCCode(cCode), cCode };
}
