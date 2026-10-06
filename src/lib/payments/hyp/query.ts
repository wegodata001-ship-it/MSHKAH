import type { HypRedirectParams } from "@/lib/payments/hyp/types";

const SECRET_KEYS = new Set(["key", "passp", "password", "signature", "sign"]);

/** Parse a query string while preserving parameter order (required for HYP VERIFY). */
export function parseOrderedQuery(rawQuery: string): Array<{ key: string; value: string }> {
  const query = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  if (!query.trim()) return [];
  return query.split("&").flatMap((part) => {
    if (!part) return [];
    const eq = part.indexOf("=");
    if (eq < 0) {
      return [{ key: decodeURIComponent(part.replace(/\+/g, " ")), value: "" }];
    }
    const key = decodeURIComponent(part.slice(0, eq).replace(/\+/g, " "));
    const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
    return [{ key, value }];
  });
}

export function findQueryValue(
  pairs: Array<{ key: string; value: string }>,
  name: string
): string {
  const match = pairs.find((pair) => pair.key.toLowerCase() === name.toLowerCase());
  return match?.value ?? "";
}

export function parseHypRedirect(rawQuery: string): HypRedirectParams {
  const pairs = parseOrderedQuery(rawQuery);
  return {
    rawQuery: rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery,
    pairs,
    id: findQueryValue(pairs, "Id"),
    cCode: findQueryValue(pairs, "CCode"),
    amount: findQueryValue(pairs, "Amount"),
    aCode: findQueryValue(pairs, "ACode"),
    order: findQueryValue(pairs, "Order"),
    coin: findQueryValue(pairs, "Coin"),
    sign: findQueryValue(pairs, "Sign"),
  };
}

export function parseHypResponseBody(body: string): Record<string, string> {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("<")) {
    return { CCode: "html" };
  }
  const result: Record<string, string> = {};
  for (const pair of parseOrderedQuery(trimmed)) {
    result[pair.key] = pair.value;
  }
  return result;
}

export function isHypSuccessCCode(cCode: string): boolean {
  return cCode.trim() === "0";
}

export function looksLikeHypErrorBody(body: string): boolean {
  const parsed = parseHypResponseBody(body);
  if (parsed.CCode && parsed.CCode !== "0") return true;
  if (parsed.action === "pay" && parsed.signature) return false;
  return body.trim().startsWith("<");
}

/** Safe fields for server logs — never API key, PassP, card data, or signatures. */
export function hypLogFields(input: {
  orderId?: string;
  paymentAttemptId?: string;
  providerErrorCode?: string;
  extra?: Record<string, string | number | undefined>;
}): Record<string, string | number | undefined> {
  return {
    orderId: input.orderId,
    paymentAttemptId: input.paymentAttemptId,
    providerErrorCode: input.providerErrorCode,
    timestamp: new Date().toISOString(),
    ...input.extra,
  };
}

export function stripSecretsFromQuery(raw: string): string {
  return parseOrderedQuery(raw)
    .filter((pair) => !SECRET_KEYS.has(pair.key.toLowerCase()))
    .map((pair) => `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`)
    .join("&");
}
