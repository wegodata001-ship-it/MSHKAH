import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

async function adminToken() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!password || !key) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = (await res.json()) as { idToken?: string };
  return data.idToken ?? null;
}

async function probe(url: string, token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  console.log(JSON.stringify({ url, status: res.status, retryAfter: res.headers.get("retry-after"), body: text.slice(0, 400) }));
}

async function probeGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ gemini: "no-key" }));
    return;
  }
  const models = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    headers: { "x-goog-api-key": key },
  });
  const generate = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: 'Reply with JSON {"ok":true} only.' }] }] }),
  });
  const genBody = await generate.json().catch(() => null);
  console.log(
    JSON.stringify({
      modelsStatus: models.status,
      generateStatus: generate.status,
      retryAfter: generate.headers.get("retry-after"),
      reason: genBody?.error?.status || genBody?.error?.message?.slice(0, 160) || null,
    })
  );
}

async function main() {
  await probeGemini();
  const token = await adminToken();
  await probe("https://portal.mishkatcafe.dev/api/admin/inventory/invoice/ai-status", token);
  await probe("https://mshkah.vercel.app/api/admin/inventory/invoice/ai-status", token);
}

void main();
