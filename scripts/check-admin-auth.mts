import { config } from "dotenv";
config({ path: ".env" });

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@mishkat.cafe";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!password || !key) {
    console.log(JSON.stringify({ ok: false, error: "missing env" }));
    process.exit(2);
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = (await res.json()) as {
    idToken?: string;
    localId?: string;
    error?: { message?: string };
  };
  console.log(
    JSON.stringify({
      status: res.status,
      ok: res.ok,
      error: data.error?.message ?? null,
      hasIdToken: Boolean(data.idToken),
      hasLocalId: Boolean(data.localId),
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
