"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowRight, Loader2, LogOut, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import type { LoyaltyMeResponse } from "@/lib/loyalty/types";

/**
 * Digital member card. Shows name, member number, status, point balance,
 * earn ratio, redeem value (only when configured), and the recent history.
 *
 * The QR encodes **only** the member number — never email, points, or any
 * discount token. Per spec: "QR לזיהוי הכרטיס ללא חשיפת פרטים אישיים".
 */
export default function ClubMemberCardPage() {
  const t = useT();
  const { locale } = useLocale();
  const [me, setMe] = useState<LoyaltyMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/club/me")
      .then((response) => response.json() as Promise<LoyaltyMeResponse>)
      .then((data) => {
        if (!active) return;
        setMe(data);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const member = me?.member ?? null;
  const settings = me?.settings;
  const redemptionReady = Boolean(settings?.redemptionEnabled && settings?.pointValueApproved && settings?.pointValueMinor);
  const estimatedValueIls = useMemo(() => {
    if (!member || !redemptionReady || !settings?.pointValueMinor) return null;
    return (member.balancePoints * settings.pointValueMinor) / 100;
  }, [member, redemptionReady, settings?.pointValueMinor]);

  useEffect(() => {
    if (!member) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(`MISHKAH:MEMBER:${member.memberNumber}`, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [member]);

  async function signOut() {
    await fetch("/api/club/session", { method: "POST" });
    window.location.href = "/club";
  }

  if (loading) {
    return (
      <>
        <PageHeader />
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
        </div>
      </>
    );
  }

  if (!member) {
    return (
      <>
        <PageHeader />
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-10 text-center">
          <h1 className="font-display text-xl font-semibold text-dark-brown">{t("club.me.notMemberTitle")}</h1>
          <p className="text-sm text-coffee/70">{t("club.me.notMemberBody")}</p>
          <Link href="/club">
            <Button variant="turquoise">
              <Sparkles className="h-4 w-4" /> {t("club.me.joinCta")}
            </Button>
          </Link>
        </div>
      </>
    );
  }

  if (member.status === "awaiting_payment" || member.status === "email_verified") {
    return (
      <>
        <PageHeader />
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-10 text-center">
          <h1 className="font-display text-xl font-semibold text-dark-brown">
            {t("club.me.pendingTitle")}
          </h1>
          <p className="text-sm text-coffee/70">{t("club.me.pendingBody")}</p>
          <Link href="/club">
            <Button variant="turquoise">{t("club.me.resumeCta")}</Button>
          </Link>
        </div>
      </>
    );
  }

  const localeTag = locale === "ar" ? "ar" : locale === "en" ? "en" : "he";

  return (
    <>
      <PageHeader />
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6 md:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-dark-brown via-coffee to-turquoise p-6 text-warm-white shadow-elevated">
          <div className="flex items-center justify-between text-xs opacity-80">
            <span>{t("club.me.memberLabel")}</span>
            <span className="rounded-full bg-warm-white/20 px-2 py-0.5 text-[11px] uppercase">
              {t(`club.me.status.${member.status}`)}
            </span>
          </div>
          <div className="mt-3 text-sm opacity-85">{member.displayName || member.email}</div>
          <div className="mt-1 font-display text-2xl font-bold tracking-wide">
            {member.memberNumber}
          </div>

          <div className="mt-6 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs opacity-70">{t("club.me.balanceLabel")}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold">{member.balancePoints}</span>
                <span className="text-xs opacity-80">{t("club.me.pointsSuffix")}</span>
              </div>
              {estimatedValueIls != null ? (
                <div className="mt-1 text-xs opacity-80">
                  ≈ {formatIls(estimatedValueIls)}
                </div>
              ) : null}
            </div>
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                alt={t("club.me.qrAlt")}
                className="h-24 w-24 rounded-xl bg-warm-white p-2"
              />
            ) : null}
          </div>

          <div className="mt-5 flex items-center justify-between text-xs opacity-80">
            <span>
              {t("club.me.earnLabel")}: {settings?.earnPointsPer100 ?? 10} / 100₪
            </span>
            {redemptionReady ? (
              <span>
                {t("club.me.redeemLabel")}: {(settings!.pointValueMinor / 100).toFixed(2)}₪ /{" "}
                {t("club.me.pointSuffixShort")}
              </span>
            ) : (
              <span>{t("club.me.redeemLocked")}</span>
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-warm-white p-5 shadow-soft">
          <h2 className="font-display text-lg font-semibold text-dark-brown">
            {t("club.me.historyTitle")}
          </h2>
          {me!.history.length === 0 ? (
            <p className="mt-3 text-sm text-coffee/60">{t("club.me.historyEmpty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-beige-dark/15">
              {me!.history.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-dark-brown">
                      {t(`club.me.kind.${entry.kind}`)}
                    </div>
                    <div className="text-xs text-coffee/60">
                      {new Date(entry.createdAt).toLocaleString(
                        localeTag === "ar" ? "ar-SA" : localeTag === "en" ? "en-GB" : "he-IL"
                      )}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </div>
                  </div>
                  <div
                    className={`font-semibold tabular-nums ${
                      entry.points > 0 ? "text-emerald-700" : entry.points < 0 ? "text-red-700" : "text-coffee/70"
                    }`}
                  >
                    {entry.points > 0 ? `+${entry.points}` : entry.points}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/" className="flex-1">
            <Button variant="outline" className="w-full">
              <ArrowRight className="h-4 w-4" /> {t("club.me.backToStore")}
            </Button>
          </Link>
          <Button variant="ghost" onClick={() => void signOut()} className="flex-1 text-coffee/60">
            <LogOut className="h-4 w-4" /> {t("club.me.signOut")}
          </Button>
        </div>
      </div>
    </>
  );
}
