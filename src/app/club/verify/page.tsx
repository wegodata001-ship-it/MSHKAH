"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";

type VerifyError =
  | "mismatch"
  | "expired"
  | "throttled"
  | "used"
  | "no_token"
  | "enrollment_disabled";

/**
 * `ClubVerifyContent` holds all the client state and the `useSearchParams`
 * call. Next.js 15 bails this subtree out of static prerendering, so the
 * default export must wrap it in a Suspense boundary — otherwise the
 * production build fails with "useSearchParams() should be wrapped in a
 * suspense boundary".
 */
function ClubVerifyContent() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const email = params?.get("email") ?? "";
  const name = params?.get("name") ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<VerifyError | null>(null);

  async function submit() {
    if (!email.trim() || code.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/club/enroll/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.trim(), displayName: name || undefined }),
    });
    const data = (await response.json().catch(() => null)) as
      | { ok: true }
      | { ok: false; reason: VerifyError }
      | null;
    setBusy(false);
    if (data?.ok) {
      // Go straight to the pay step.
      await startPayment();
      return;
    }
    setError(data && !data.ok ? data.reason : "mismatch");
  }

  async function startPayment() {
    const response = await fetch("/api/club/enroll/pay", { method: "POST" });
    const data = (await response.json().catch(() => null)) as
      | { ok: true; paymentUrl: string }
      | { error: string; code: string }
      | null;
    if (data && "paymentUrl" in data) {
      window.location.href = data.paymentUrl;
    } else {
      router.push(`/club/activate?status=${encodeURIComponent((data?.code || "pay_failed").toLowerCase())}`);
    }
  }

  async function resend() {
    if (!email.trim() || busy) return;
    setBusy(true);
    await fetch("/api/club/enroll/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6 md:px-6">
      <div className="rounded-3xl bg-warm-white p-5 shadow-soft">
        <h1 className="font-display text-xl font-semibold text-dark-brown">
          {t("club.verify.title")}
        </h1>
        <p className="mt-1 text-xs text-coffee/60">
          {t("club.verify.subtitle").replace("{email}", email)}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            value={code}
            maxLength={6}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="text-center text-xl tracking-widest"
          />
          <Button
            type="button"
            variant="turquoise"
            disabled={busy || code.length !== 6}
            onClick={() => void submit()}
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("club.verify.verifying")}
              </>
            ) : (
              t("club.verify.submit")
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void resend()} disabled={busy} className="w-full">
            {t("club.verify.resend")}
          </Button>
        </div>
        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            {t(`club.verify.err.${error}`)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ClubVerifyFallback() {
  return (
    <div className="mx-auto flex max-w-md items-center justify-center px-4 py-10">
      <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
    </div>
  );
}

export default function ClubVerifyPage() {
  return (
    <>
      <PageHeader />
      <Suspense fallback={<ClubVerifyFallback />}>
        <ClubVerifyContent />
      </Suspense>
    </>
  );
}
