import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

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
  form.set("invoiceId", "RoA1BEbQlbl6VvkvdfYU");
  const res = await fetch("http://localhost:3000/api/admin/inventory/invoice/extract", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json()) as {
    ok?: boolean;
    model?: string;
    invoice?: { id?: string; invoiceNumber?: string; stockStatus?: string; status?: string; lines?: unknown[] };
  };
  console.log(JSON.stringify({ status: res.status, ok: data.ok, model: data.model, id: data.invoice?.id, number: data.invoice?.invoiceNumber, stock: data.invoice?.stockStatus, statusText: data.invoice?.status, lines: data.invoice?.lines?.length }));
}

void main();
