"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT, useLocale } from "@/components/providers/locale-provider";
import type { LoyaltyMeResponse } from "@/lib/loyalty/types";

/**
 * Public join card. Shows the join fee, earn ratio, and current terms, then
 * walks the visitor through: email → verify → pay → activate.
 *
 * We never render membership-only state here; a visitor who is already a
 * member is redirected to `/club/me` by the `useEffect` below.
 */
export default function ClubJoinPage() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [me, setMe] = useState<LoyaltyMeResponse | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/club/me")
      .then((response) => response.json() as Promise<LoyaltyMeResponse>)
      .then((data) => {
        if (!active) return;
        setMe(data);
        if (data.member?.status === "active") {
          router.replace("/club/me");
        }
      })
      .catch(() => {
        if (!active) return;
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function requestCode() {
    if (!email.trim()) return;
    setSending(true);
    await fetch("/api/club/enroll/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setSending(false);
    const target = new URLSearchParams({ email: email.trim() });
    if (name.trim()) target.set("name", name.trim());
    router.push(`/club/verify?${target.toString()}`);
  }

  const settings = me?.settings;
  const joinFee = settings ? (settings.joinFeeMinor / 100).toFixed(2) : "20.00";
  const enrollmentClosed = settings ? !settings.enrollmentEnabled : false;
  const terms =
    settings?.[`terms${locale === "en" ? "En" : locale === "ar" ? "Ar" : "He"}` as const] ?? "";

  return (
    <>
      <PageHeader />
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6 md:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-dark-brown via-coffee to-turquoise p-6 text-warm-white shadow-elevated">
          <div className="flex items-center gap-2 text-sm opacity-85">
            <Sparkles className="h-4 w-4" />
            {t("club.join.hero.badge")}
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold md:text-3xl">
            {t("club.join.hero.title")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed opacity-85">
            {t("club.join.hero.subtitle")}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-warm-white/15 p-3 backdrop-blur">
              <div className="text-xs uppercase opacity-70">{t("club.join.ratioLabel")}</div>
              <div className="mt-1 text-lg font-semibold">
                {settings ? `${settings.earnPointsPer100} / 100₪` : "—"}
              </div>
            </div>
            <div className="rounded-2xl bg-warm-white/15 p-3 backdrop-blur">
              <div className="text-xs uppercase opacity-70">{t("club.join.feeLabel")}</div>
              <div className="mt-1 text-lg font-semibold">₪{joinFee}</div>
            </div>
          </div>
        </div>

        {enrollmentClosed ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {t("club.join.closed")}
          </div>
        ) : (
          <div className="rounded-3xl bg-warm-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-dark-brown">{t("club.join.formTitle")}</h2>
            <p className="mt-1 text-xs text-coffee/60">{t("club.join.formHint")}</p>
            <div className="mt-4 flex flex-col gap-3">
              <Input
                type="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
              <Input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("club.join.nameHint")}
              />
              <Button
                type="button"
                variant="turquoise"
                disabled={sending || !email.trim()}
                onClick={() => void requestCode()}
                className="w-full"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("club.join.sending")}
                  </>
                ) : (
                  t("club.join.sendCode")
                )}
              </Button>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-beige/50 p-3 text-xs text-coffee/70">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-turquoise" />
              <p>{t("club.join.securityNote")}</p>
            </div>
          </div>
        )}

        {terms ? (
          <div className="rounded-2xl border border-beige-dark/20 bg-warm-white p-4 text-xs leading-relaxed text-coffee/80">
            <div className="mb-2 font-semibold text-dark-brown">{t("club.join.termsTitle")}</div>
            <div style={{ whiteSpace: "pre-line" }}>{terms}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
