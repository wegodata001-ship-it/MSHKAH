import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { recordCustomerOrder, upsertCheckoutCustomer } from "@/lib/customers/checkout-customer";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { phoneKey } from "@/lib/customers/identity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    phone?: string;
    email?: string;
    customerId?: string;
    orderId?: string;
  } | null;
  if (!body) return Response.json({ ok: false }, { status: 400 });

  const db = getAdminDb();
  if (body.orderId && body.customerId) {
    try {
      await recordCustomerOrder(db, body.customerId, body.orderId);
      return Response.json({ ok: true, customerId: body.customerId });
    } catch {
      return Response.json({ ok: false }, { status: 400 });
    }
  }

  const digits = phoneKey(body.phone);
  if (!body.name?.trim() || digits.length < 9) return Response.json({ ok: false }, { status: 400 });
  const limit = await consumeRateLimit(db, {
    key: rateLimitKey(["checkout-customer", digits]),
    windowSeconds: 60 * 60,
    limit: 120,
  });
  if (!limit.ok) return Response.json({ ok: false }, { status: 429 });

  try {
    const result = await upsertCheckoutCustomer(db, { name: body.name, phone: body.phone ?? "", email: body.email });
    return Response.json({ ok: true, customerId: result.customerId });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}
