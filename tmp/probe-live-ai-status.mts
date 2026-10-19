import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

async function token() {
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
  const data = (await auth.json()) as { idToken?: string };
  if (!data.idToken) throw new Error("no admin token");
  return data.idToken;
}

async function get(url: string, idToken: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 240);
  }
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body };
}

async function main() {
  const idToken = await token();
  const hosts = [
    "http://localhost:3000",
    "https://portal.mishkatcafe.dev",
    "https://mshkah.vercel.app",
  ];
  for (const host of hosts) {
    const aiStatus = await get(`${host}/api/admin/inventory/invoice/ai-status`, idToken);
    const health = await get(`${host}/api/admin/ai/health`, idToken);
    console.log(JSON.stringify({ host, aiStatus, health }));
  }
}

void main();
