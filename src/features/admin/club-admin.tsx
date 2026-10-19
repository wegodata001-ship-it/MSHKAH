"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Send, ShieldAlert, Sparkles } from "lucide-react";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminCard } from "@/features/admin/components/admin-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/providers/locale-provider";
import {
  saveLoyaltySettings,
  sendLoyaltyTestEmail,
  subscribeToLoyaltySettings,
} from "@/services/loyaltyService";
import {
  DEFAULT_LOYALTY_SETTINGS,
  type LoyaltySettings,
} from "@/lib/loyalty/types";
import { pausedCapabilities } from "@/lib/loyalty/settings";
import { fromMinor, toMinor } from "@/lib/loyalty/points-math";

/**
 * Admin club panel. Three cards:
 *   1. Capability toggles (enrollment / earn / redemption) with a clear
 *      summary of what is currently paused.
 *   2. Numeric configuration (join fee, earn ratio, point value, min/max,
 *      rounding mode) + the explicit "approve point value" switch.
 *   3. Terms textarea per locale.
 *   4. "Send test email" footer.
 */
export function ClubAdmin() {
  const t = useT();
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [draft, setDraft] = useState<LoyaltySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToLoyaltySettings((data) => {
      setSettings(data);
      setDraft((current) => current ?? data);
    });
    return () => unsubscribe();
  }, []);

  const dirty = useMemo(() => {
    if (!settings || !draft) return false;
    return JSON.stringify(settings) !== JSON.stringify(draft);
  }, [settings, draft]);

  const paused = draft ? pausedCapabilities(draft) : [];

  if (!draft) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-turquoise" />
      </div>
    );
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const result = await saveLoyaltySettings(draft);
    setSaving(false);
    if (result.success) {
      setSettings(result.data);
      setDraft(result.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function sendTest() {
    if (!testEmail.trim()) return;
    setTestSending(true);
    setTestStatus(null);
    const result = await sendLoyaltyTestEmail({ to: testEmail.trim() });
    setTestSending(false);
    setTestStatus(result.success ? "ok" : result.error || "failed");
  }

  function patch(update: Partial<LoyaltySettings>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("admin.club.title")}
        subtitle={t("admin.club.subtitle")}
        actions={
          <Button onClick={save} disabled={saving || !dirty} className="h-10 rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? t("admin.action.saved") : t("admin.club.save")}
          </Button>
        }
      />

      {paused.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-4 w-4" />
            {t("admin.club.pausedTitle")}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 ps-6 text-xs">
            {paused.map((item) => (
              <li key={item}>{t(`admin.club.paused.${item}`)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4" />
            {t("admin.club.allActive")}
          </div>
        </div>
      )}

      <AdminCard title={t("admin.club.capabilities.title")}>
        <div className="grid gap-3 md:grid-cols-3">
          <ToggleRow
            label={t("admin.club.capabilities.enrollment")}
            description={t("admin.club.capabilities.enrollmentHint")}
            checked={draft.enrollmentEnabled}
            onChange={(value) => patch({ enrollmentEnabled: value })}
          />
          <ToggleRow
            label={t("admin.club.capabilities.earn")}
            description={t("admin.club.capabilities.earnHint")}
            checked={draft.earnEnabled}
            onChange={(value) => patch({ earnEnabled: value })}
          />
          <ToggleRow
            label={t("admin.club.capabilities.redemption")}
            description={t("admin.club.capabilities.redemptionHint")}
            checked={draft.redemptionEnabled}
            disabled={!draft.pointValueApproved || draft.pointValueMinor <= 0}
            onChange={(value) => patch({ redemptionEnabled: value })}
          />
        </div>
        {(!draft.pointValueApproved || draft.pointValueMinor <= 0) ? (
          <p className="mt-3 text-xs text-amber-900">{t("admin.club.capabilities.redemptionBlocked")}</p>
        ) : null}
      </AdminCard>

      <AdminCard title={t("admin.club.values.title")}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="joinFee">{t("admin.club.values.joinFee")}</Label>
            <Input
              id="joinFee"
              type="number"
              min="0"
              step="0.01"
              value={fromMinor(draft.joinFeeMinor)}
              onChange={(event) =>
                patch({ joinFeeMinor: toMinor(Number(event.target.value || 0)) })
              }
            />
            <p className="mt-1 text-xs text-coffee/60">{t("admin.club.values.joinFeeHint")}</p>
          </div>
          <div>
            <Label htmlFor="earnRatio">{t("admin.club.values.earnRatio")}</Label>
            <Input
              id="earnRatio"
              type="number"
              min="0"
              step="1"
              value={draft.earnPointsPer100}
              onChange={(event) =>
                patch({ earnPointsPer100: Math.max(0, Math.floor(Number(event.target.value || 0))) })
              }
            />
            <p className="mt-1 text-xs text-coffee/60">{t("admin.club.values.earnRatioHint")}</p>
          </div>
          <div>
            <Label htmlFor="pointValue">{t("admin.club.values.pointValue")}</Label>
            <Input
              id="pointValue"
              type="number"
              min="0"
              step="0.01"
              value={fromMinor(draft.pointValueMinor)}
              onChange={(event) =>
                patch({ pointValueMinor: toMinor(Number(event.target.value || 0)) })
              }
            />
            <p className="mt-1 text-xs text-coffee/60">{t("admin.club.values.pointValueHint")}</p>
          </div>
          <div>
            <Label htmlFor="roundingMode">{t("admin.club.values.rounding")}</Label>
            <select
              id="roundingMode"
              className="mt-1 h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
              value={draft.roundingMode}
              onChange={(event) => patch({ roundingMode: event.target.value as "down" | "nearest" })}
            >
              <option value="down">{t("admin.club.values.roundingDown")}</option>
              <option value="nearest">{t("admin.club.values.roundingNearest")}</option>
            </select>
            <p className="mt-1 text-xs text-coffee/60">{t("admin.club.values.roundingHint")}</p>
          </div>
          <div>
            <Label htmlFor="minRedeem">{t("admin.club.values.min")}</Label>
            <Input
              id="minRedeem"
              type="number"
              min="0"
              step="1"
              value={draft.redemptionMinPoints}
              onChange={(event) =>
                patch({ redemptionMinPoints: Math.max(0, Math.floor(Number(event.target.value || 0))) })
              }
            />
          </div>
          <div>
            <Label htmlFor="maxRedeem">{t("admin.club.values.max")}</Label>
            <Input
              id="maxRedeem"
              type="number"
              min="0"
              step="1"
              value={draft.redemptionMaxPoints}
              onChange={(event) =>
                patch({ redemptionMaxPoints: Math.max(0, Math.floor(Number(event.target.value || 0))) })
              }
            />
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-beige-dark/30 bg-beige/30 p-3">
          <label className="flex items-start gap-2 text-sm text-dark-brown">
            <input
              type="checkbox"
              checked={draft.pointValueApproved}
              onChange={(event) => patch({ pointValueApproved: event.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">{t("admin.club.values.approveTitle")}</span>
              <span className="mt-1 block text-xs text-coffee/60">
                {t("admin.club.values.approveHint")}
              </span>
            </span>
          </label>
        </div>
      </AdminCard>

      <AdminCard title={t("admin.club.terms.title")}>
        <p className="mb-3 text-xs text-coffee/60">{t("admin.club.terms.hint")}</p>
        <div className="grid gap-3">
          <div>
            <Label>{t("admin.club.terms.he")}</Label>
            <Textarea
              rows={3}
              value={draft.termsHe ?? ""}
              onChange={(event) => patch({ termsHe: event.target.value })}
            />
          </div>
          <div>
            <Label>{t("admin.club.terms.ar")}</Label>
            <Textarea
              rows={3}
              value={draft.termsAr ?? ""}
              onChange={(event) => patch({ termsAr: event.target.value })}
            />
          </div>
          <div>
            <Label>{t("admin.club.terms.en")}</Label>
            <Textarea
              rows={3}
              value={draft.termsEn ?? ""}
              onChange={(event) => patch({ termsEn: event.target.value })}
            />
          </div>
        </div>
      </AdminCard>

      <AdminCard title={t("admin.club.testEmail.title")}>
        <p className="text-xs text-coffee/60">{t("admin.club.testEmail.hint")}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            dir="ltr"
            type="email"
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            placeholder="qa@example.com"
            className="flex-1"
          />
          <Button
            type="button"
            variant="turquoise"
            disabled={testSending || !testEmail.trim()}
            onClick={() => void sendTest()}
          >
            {testSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("admin.club.testEmail.sending")}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {t("admin.club.testEmail.send")}
              </>
            )}
          </Button>
        </div>
        {testStatus === "ok" ? (
          <p className="mt-2 text-xs text-emerald-700">{t("admin.club.testEmail.ok")}</p>
        ) : testStatus ? (
          <p className="mt-2 text-xs text-red-700">{t("admin.club.testEmail.failed").replace("{code}", testStatus)}</p>
        ) : null}
      </AdminCard>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-2 rounded-2xl border p-3 text-sm transition-colors ${
      disabled ? "cursor-not-allowed border-beige-dark/20 bg-stone-50 text-coffee/50" : "cursor-pointer border-beige-dark/30 bg-warm-white hover:bg-beige/40"
    }`}>
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="mt-1 block text-xs opacity-80">{description}</span>
      </span>
    </label>
  );
}

// `DEFAULT_LOYALTY_SETTINGS` is referenced here only so that TypeScript keeps
// the import alive and the admin bundle can round-trip saved shape → default.
void DEFAULT_LOYALTY_SETTINGS;
