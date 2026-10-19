"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";

/**
 * Terminal page shown after HYP redirects back for a club join. If activation
 * succeeded we auto-redirect from `/api/club/enroll/complete` to `/club/me`.
 * This page is the sad-path landing for `?status=verify_failed` etc.
 *
 * `useSearchParams` is used inside `ClubActivateContent` and bails out of
 * static prerendering, which is why we have to wrap it in a Suspense
 * boundary from the default export. The boundary is required by Next.js 15
 * so the shell can still be prerendered.
 */
function ClubActivateContent() {
  const t = useT();
  const params = useSearchParams();
  const status = params?.get("status") ?? "unknown";

  const copyKey = status === "unknown" ? "unknown" : status;
  const title = t(`club.activate.${copyKey}.title`);
  const body = t(`club.activate.${copyKey}.body`);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6 md:px-6">
      <div className="flex flex-col items-center rounded-3xl bg-warm-white p-6 text-center shadow-soft">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <h1 className="mt-3 font-display text-xl font-semibold text-dark-brown">{title}</h1>
        <p className="mt-2 text-sm text-coffee/70">{body}</p>
        <div className="mt-5 flex w-full flex-col gap-2">
          <Link href="/club">
            <Button variant="turquoise" className="w-full">
              <CheckCircle2 className="h-4 w-4" />
              {t("club.activate.tryAgain")}
            </Button>
          </Link>
          <Link href="/">
            <Button variant="outline" className="w-full">
              {t("club.activate.backHome")}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ClubActivateFallback() {
  return (
    <div className="mx-auto flex max-w-md items-center justify-center px-4 py-10">
      <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
    </div>
  );
}

export default function ClubActivatePage() {
  return (
    <>
      <PageHeader />
      <Suspense fallback={<ClubActivateFallback />}>
        <ClubActivateContent />
      </Suspense>
    </>
  );
}
