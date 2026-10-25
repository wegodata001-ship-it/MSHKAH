"use client";

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUpload } from "@/features/admin/image-upload";
import {
  subscribeToSettings,
  updateSettings,
  type AppSettings,
} from "@/services/settingsService";
import {
  uploadSettingsImage,
  deleteImageByUrl,
} from "@/services/storageService";
import { SystemStatusCard } from "@/features/admin/system-status-card";
import { MeasureUnitsSettings } from "@/features/admin/measure-units-settings";
import { useT } from "@/components/providers/locale-provider";
import { AdminPageHeader } from "./components/admin-page-header";
import { AdminCard } from "./components/admin-card";
import { adminInput } from "./components/admin-styles";

export function SettingsAdmin() {
  const t = useT();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    return subscribeToSettings(setSettings, () => {});
  }, []);

  if (!settings) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-turquoise" />
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await updateSettings(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const themeLabels = {
    primary: t("admin.settings.themePrimary"),
    accent: t("admin.settings.themeAccent"),
    background: t("admin.settings.themeBackground"),
  } as const;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t("admin.settings.title")}
        subtitle={t("admin.settings.subtitle")}
        actions={
          <Button onClick={handleSave} disabled={saving} className="h-10 rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? t("admin.action.saved") : t("admin.settings.saveChanges")}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title={t("admin.settings.businessInfo")}>
          <div className="space-y-4">
            <div>
              <Label>{t("admin.settings.storeName")}</Label>
              <Input
                value={settings.storeName}
                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
            <div>
              <Label>{t("admin.settings.phone")}</Label>
              <Input
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
            <div>
              <Label>{t("admin.settings.address")}</Label>
              <Input
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
            <div>
              <Label>{t("admin.settings.hours")}</Label>
              <Textarea
                value={settings.hours}
                onChange={(e) => setSettings({ ...settings, hours: e.target.value })}
                className={`mt-1 rounded-xl ${adminInput}`}
              />
            </div>
          </div>
        </AdminCard>

        <AdminCard title={t("admin.settings.branding")}>
          <div className="space-y-4">
            <ImageUpload
              label={t("admin.settings.logo")}
              value={settings.logoUrl}
              onChange={(url) => setSettings({ ...settings, logoUrl: url })}
              onUpload={(file, onProgress) => uploadSettingsImage(file, "logo", onProgress)}
              onDelete={deleteImageByUrl}
            />
            <ImageUpload
              label={t("admin.settings.storeImage")}
              value={settings.storeImageUrl}
              onChange={(url) => setSettings({ ...settings, storeImageUrl: url })}
              onUpload={(file, onProgress) => uploadSettingsImage(file, "store", onProgress)}
              onDelete={deleteImageByUrl}
            />
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-beige-dark/20 px-4 py-3 dark:border-white/10">
              <input
                type="checkbox"
                checked={settings.showProductThumbnails}
                onChange={(e) =>
                  setSettings({ ...settings, showProductThumbnails: e.target.checked })
                }
                className="h-4 w-4 rounded border-beige-dark text-turquoise focus:ring-turquoise"
              />
              <span className="text-sm text-coffee dark:text-warm-white/90">
                {t("admin.settings.showProductThumbnails")}
              </span>
            </label>
          </div>
        </AdminCard>

        <AdminCard title={t("admin.settings.seoSocial")} className="dark:bg-[#1a1412]/80">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("admin.settings.seoTitle")}</Label>
              <Input
                value={settings.seo.title}
                onChange={(e) => setSettings({ ...settings, seo: { ...settings.seo, title: e.target.value } })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
            <div>
              <Label>{t("admin.settings.whatsapp")}</Label>
              <Input
                value={settings.social.whatsapp}
                onChange={(e) => setSettings({ ...settings, social: { ...settings.social, whatsapp: e.target.value } })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>{t("admin.settings.seoDescription")}</Label>
              <Textarea
                value={settings.seo.description}
                onChange={(e) => setSettings({ ...settings, seo: { ...settings.seo, description: e.target.value } })}
                className={`mt-1 rounded-xl ${adminInput}`}
              />
            </div>
            <div>
              <Label>{t("admin.settings.instagram")}</Label>
              <Input
                value={settings.social.instagram}
                onChange={(e) => setSettings({ ...settings, social: { ...settings.social, instagram: e.target.value } })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
            <div>
              <Label>{t("admin.settings.mapsUrl")}</Label>
              <Input
                value={settings.mapsUrl}
                onChange={(e) => setSettings({ ...settings, mapsUrl: e.target.value })}
                className={`mt-1 ${adminInput}`}
              />
            </div>
          </div>
        </AdminCard>

        <MeasureUnitsSettings />

        <SystemStatusCard />

        <AdminCard title={t("admin.settings.themeColors")} className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            {(["primary", "accent", "background"] as const).map((key) => (
              <div key={key}>
                <Label>{themeLabels[key]}</Label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="color"
                    value={settings.theme[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        theme: { ...settings.theme, [key]: e.target.value },
                      })
                    }
                    className="h-10 w-12 cursor-pointer rounded-lg border"
                  />
                  <Input
                    value={settings.theme[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        theme: { ...settings.theme, [key]: e.target.value },
                      })
                    }
                    className={adminInput}
                  />
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      </div>
    </div>
  );
}
