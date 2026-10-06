import { NextRequest, NextResponse } from "next/server";
import { HypConfigError } from "@/lib/payments/hyp/config";
import { createHypPaymentAttempt, HypPaymentError } from "@/lib/payments/hyp/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      orderId?: unknown;
      amount?: unknown;
      customerName?: unknown;
      customerPhone?: unknown;
      customerEmail?: unknown;
    };
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    void body.amount;

    const result = await createHypPaymentAttempt(orderId, {
      name: typeof body.customerName === "string" ? body.customerName : undefined,
      phone: typeof body.customerPhone === "string" ? body.customerPhone : undefined,
      email: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
    });
    return NextResponse.json({
      ok: true,
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
    });
  } catch (error) {
    if (error instanceof HypConfigError) {
      return NextResponse.json(
        { ok: false, error: "HYP_NOT_CONFIGURED", message: error.message },
        { status: 503 }
      );
    }
    if (error instanceof HypPaymentError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { ok: false, error: "HYP_UNAVAILABLE", message: "Could not open the secure payment page" },
      { status: 502 }
    );
  }
}
