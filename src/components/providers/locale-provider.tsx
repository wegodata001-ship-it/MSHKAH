"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  LOCALES,
  type Locale,
  type TranslationMap,
} from "@/lib/i18n/types";
import { fetchAllLocaleStrings } from "@/services/translationService";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";
import { LocaleHtmlSync } from "@/components/providers/locale-html-sync";
import { applyLocaleFonts } from "@/lib/typography/locale-fonts";

const STORAGE_KEY = "mishkat-locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
  dir: "rtl" | "ltr";
  loading: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LOCALES.includes(stored as Locale)) return stored as Locale;
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [strings, setStrings] = useState<Record<Locale, TranslationMap>>({
    he: {},
    ar: {},
    en: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initial = readStoredLocale();
    setLocaleState(initial);
    applyLocaleFonts(initial);
    fetchAllLocaleStrings().then((all) => {
      setStrings({
        he: { ...UI_TRANSLATIONS_SEED.he, ...ADMIN_TRANSLATIONS.he, ...all.he },
        ar: { ...UI_TRANSLATIONS_SEED.ar, ...ADMIN_TRANSLATIONS.ar, ...all.ar },
        en: { ...UI_TRANSLATIONS_SEED.en, ...ADMIN_TRANSLATIONS.en, ...all.en },
      });
      setLoading(false);
    });
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    document.documentElement.dir = LOCALE_META[next].dir;
    applyLocaleFonts(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALE_META[locale].dir;
    applyLocaleFonts(locale);
  }, [locale]);

  const t = useCallback(
    (key: string, fallback?: string) => {
      const value = strings[locale]?.[key];
      if (value) return value;
      const defaultVal = strings[DEFAULT_LOCALE]?.[key];
      if (defaultVal) return defaultVal;
      const adminFallback = ADMIN_TRANSLATIONS[locale]?.[key] ?? ADMIN_TRANSLATIONS[DEFAULT_LOCALE]?.[key];
      if (adminFallback) return adminFallback;
      const seed = UI_TRANSLATIONS_SEED[locale]?.[key] ?? UI_TRANSLATIONS_SEED[DEFAULT_LOCALE]?.[key];
      if (seed) return seed;
      return fallback ?? key;
    },
    [locale, strings]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      dir: LOCALE_META[locale].dir,
      loading,
    }),
    [locale, setLocale, t, loading]
  );

  return (
    <LocaleContext.Provider value={value}>
      <LocaleHtmlSync locale={locale} />
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function useT() {
  return useLocale().t;
}
