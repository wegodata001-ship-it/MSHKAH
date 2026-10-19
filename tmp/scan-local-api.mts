import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { readFileSync } from "fs";

async function main() {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
  const auth = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe",
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      returnSecureToken: true,
    }),
  });
  const token = ((await auth.json()) as { idToken?: string }).idToken;
  if (!token) throw new Error("no admin token");
  const form = new FormData();
  form.set("file", new Blob([readFileSync("tmp/ai-fixtures/invoice.jpg")], { type: "image/jpeg" }), "TEST-QA-invoice.jpg");
  const res = await fetch("http://localhost:3000/api/admin/inventory/invoice/extract", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    code?: string;
    model?: string;
    retryAfterSeconds?: number;
    invoice?: { id?: string; invoiceNumber?: string; invoiceDate?: string; supplierName?: string; lines?: unknown[]; netAmount?: number; vatAmount?: number; grandTotal?: number };
    extraction?: { invoiceNumber?: { value?: string }; lines?: unknown[] };
  };
  console.log(
    JSON.stringify({
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      ok: data.ok,
      code: data.code,
      model: data.model,
      id: data.invoice?.id,
      number: data.invoice?.invoiceNumber || data.extraction?.invoiceNumber?.value,
      date: data.invoice?.invoiceDate,
      supplier: data.invoice?.supplierName,
      lines: data.invoice?.lines?.length ?? data.extraction?.lines?.length,
      net: data.invoice?.netAmount,
      vat: data.invoice?.vatAmount,
      total: data.invoice?.grandTotal,
    })
  );
}

void main();
