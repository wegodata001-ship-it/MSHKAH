"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  X,
  Type,
  Contrast,
  Sun,
  Moon,
  Monitor,
  Link2,
  AlignJustify,
  MoveHorizontal,
  Pause,
  Minimize2,
  MousePointer2,
  Focus,
  Keyboard,
  RotateCcw,
  Minus,
  Plus,
  Palette,
} from "lucide-react";
import { useAccessibility } from "@/components/providers/accessibility-provider";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { SpacingLevel, ThemePreference } from "@/lib/accessibility/types";

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-all",
        checked
          ? "border-turquoise/40 bg-turquoise/10 shadow-sm"
          : "border-beige-dark/25 bg-warm-white/60 hover:bg-beige/40 dark:border-white/10 dark:bg-white/5"
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          checked ? "bg-turquoise text-warm-white" : "bg-beige/80 text-coffee/70 dark:bg-white/10"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-dark-brown dark:text-warm-white">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-coffee/55 dark:text-warm-white/50">
            {description}
          </span>
        )}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-turquoise" : "bg-beige-dark/50 dark:bg-white/20"
        )}
        aria-hidden
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "start-5" : "start-0.5"
          )}
        />
      </span>
    </button>
  );
}

function SegmentGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-coffee/50 dark:text-warm-white/50">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-turquoise text-warm-white shadow-md"
                  : "bg-beige/60 text-coffee hover:bg-beige dark:bg-white/10 dark:text-warm-white"
              )}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AccessibilityCenter() {
  const t = useT();
  const { dir } = useLocale();
  const {
    settings,
    panelOpen,
    setPanelOpen,
    togglePanel,
    updateSetting,
    increaseFont,
    decreaseFont,
    setFontScale,
    setThemePreference,
    resetAll,
  } = useAccessibility();
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanelOpen(false);
        fabRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, setPanelOpen]);

  useEffect(() => {
    if (panelOpen) panelRef.current?.focus();
  }, [panelOpen]);

  const lineHeightOptions: { id: SpacingLevel; label: string }[] = [
    { id: "normal", label: t("a11y.spacing.normal") },
    { id: "medium", label: t("a11y.spacing.medium") },
    { id: "large", label: t("a11y.spacing.large") },
  ];

  const themeOptions: {
    id: ThemePreference;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "light", label: t("a11y.theme.light"), icon: Sun },
    { id: "dark", label: t("a11y.theme.dark"), icon: Moon },
    { id: "auto", label: t("a11y.theme.auto"), icon: Monitor },
  ];

  return (
    <>
      <a href="#main-content" className="skip-link">
        {t("a11y.skipToContent")}
      </a>

      {/* Floating action button — bottom end, above mobile nav */}
      <motion.button
        ref={fabRef}
        type="button"
        onClick={togglePanel}
        aria-expanded={panelOpen}
        aria-controls="a11y-panel"
        aria-label={t("a11y.openMenu")}
        className={cn(
          "a11y-fab print:hidden fixed z-40 flex h-14 w-14 items-center justify-center rounded-full",
          "glass shadow-premium border border-white/30",
          "text-turquoise transition-transform hover:scale-105 active:scale-95",
          "bottom-40 end-4 md:bottom-6 md:end-24",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turquoise focus-visible:ring-offset-2",
          panelOpen && "scale-0 opacity-0 pointer-events-none"
        )}
        whileTap={{ scale: 0.92 }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: panelOpen ? 0 : 1, scale: panelOpen ? 0.8 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <Accessibility className="h-6 w-6" strokeWidth={2.25} />
      </motion.button>

      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[45] bg-dark-brown/25 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPanelOpen(false)}
              aria-hidden
            />

            <motion.div
              id="a11y-panel"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="a11y-panel-title"
              tabIndex={-1}
              dir={dir}
              className={cn(
                "a11y-panel fixed z-[46] flex max-h-[min(85vh,720px)] w-[min(calc(100vw-2rem),400px)] flex-col",
                "rounded-3xl glass shadow-premium overflow-hidden",
                "bottom-40 end-4 md:bottom-6 md:end-24",
                "border border-white/40 dark:border-white/10"
              )}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-beige-dark/20 bg-gradient-to-b from-warm-white/90 to-transparent px-5 py-4 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-turquoise/15 text-turquoise">
                    <Accessibility className="h-6 w-6" aria-hidden />
                  </span>
                  <div>
                    <h2
                      id="a11y-panel-title"
                      className="font-display text-lg font-bold text-dark-brown dark:text-warm-white"
                    >
                      {t("a11y.title")}
                    </h2>
                    <p className="text-xs text-coffee/50 dark:text-warm-white/50">
                      {t("a11y.subtitle")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  aria-label={t("common.close")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-coffee/60 hover:bg-beige/60 dark:hover:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="a11y-panel-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {/* Text size */}
                <section aria-labelledby="a11y-text-size">
                  <p
                    id="a11y-text-size"
                    className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-coffee/50"
                  >
                    <Type className="h-3.5 w-3.5" aria-hidden />
                    {t("a11y.textSize")}
                  </p>
                  <div className="flex items-center justify-between gap-2 rounded-2xl border border-beige-dark/25 bg-warm-white/50 p-2 dark:border-white/10 dark:bg-white/5">
                    <button
                      type="button"
                      onClick={decreaseFont}
                      disabled={settings.fontScale <= 80}
                      aria-label={t("a11y.decreaseText")}
                      className="flex h-11 min-w-11 flex-1 items-center justify-center gap-1 rounded-xl bg-beige/70 text-sm font-bold hover:bg-beige disabled:opacity-40 dark:bg-white/10"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                      A−
                    </button>
                    <span className="px-2 text-center text-sm font-semibold tabular-nums text-coffee dark:text-warm-white">
                      {settings.fontScale}%
                    </span>
                    <button
                      type="button"
                      onClick={increaseFont}
                      disabled={settings.fontScale >= 120}
                      aria-label={t("a11y.increaseText")}
                      className="flex h-11 min-w-11 flex-1 items-center justify-center gap-1 rounded-xl bg-beige/70 text-sm font-bold hover:bg-beige disabled:opacity-40 dark:bg-white/10"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      A+
                    </button>
                    <button
                      type="button"
                      onClick={() => setFontScale(120)}
                      disabled={settings.fontScale >= 120}
                      aria-label={t("a11y.increaseTextLarge")}
                      className="flex h-11 min-w-11 flex-1 items-center justify-center rounded-xl bg-turquoise/15 text-sm font-bold text-turquoise hover:bg-turquoise/25 disabled:opacity-40"
                    >
                      A++
                    </button>
                  </div>
                </section>

                {/* Theme */}
                <SegmentGroup
                  label={t("a11y.theme.label")}
                  value={settings.theme}
                  options={themeOptions}
                  onChange={setThemePreference}
                />

                {/* Toggles */}
                <div className="space-y-2">
                  <ToggleRow
                    icon={Contrast}
                    label={t("a11y.highContrast")}
                    description={t("a11y.highContrastDesc")}
                    checked={settings.highContrast}
                    onChange={(v) => updateSetting("highContrast", v)}
                  />
                  <ToggleRow
                    icon={Palette}
                    label={t("a11y.grayscale")}
                    description={t("a11y.grayscaleDesc")}
                    checked={settings.grayscale}
                    onChange={(v) => updateSetting("grayscale", v)}
                  />
                  <ToggleRow
                    icon={Link2}
                    label={t("a11y.highlightLinks")}
                    checked={settings.highlightLinks}
                    onChange={(v) => updateSetting("highlightLinks", v)}
                  />
                  <ToggleRow
                    icon={Type}
                    label={t("a11y.accessibleFont")}
                    description={t("a11y.accessibleFontDesc")}
                    checked={settings.accessibleFont}
                    onChange={(v) => updateSetting("accessibleFont", v)}
                  />
                  <ToggleRow
                    icon={Focus}
                    label={t("a11y.enhancedFocus")}
                    checked={settings.enhancedFocus}
                    onChange={(v) => updateSetting("enhancedFocus", v)}
                  />
                  <ToggleRow
                    icon={Keyboard}
                    label={t("a11y.keyboardNav")}
                    checked={settings.keyboardNav}
                    onChange={(v) => updateSetting("keyboardNav", v)}
                  />
                  <ToggleRow
                    icon={MousePointer2}
                    label={t("a11y.largeCursor")}
                    checked={settings.largeCursor}
                    onChange={(v) => updateSetting("largeCursor", v)}
                  />
                  <ToggleRow
                    icon={Minimize2}
                    label={t("a11y.reduceMotion")}
                    checked={settings.reduceMotion}
                    onChange={(v) => updateSetting("reduceMotion", v)}
                  />
                  <ToggleRow
                    icon={Pause}
                    label={t("a11y.pauseAnimations")}
                    checked={settings.pauseAnimations}
                    onChange={(v) => updateSetting("pauseAnimations", v)}
                  />
                </div>

                {/* Line height */}
                <SegmentGroup
                  label={t("a11y.lineHeight")}
                  value={settings.lineHeight}
                  options={lineHeightOptions.map((o) => ({ ...o, icon: AlignJustify }))}
                  onChange={(v) => updateSetting("lineHeight", v)}
                />

                {/* Letter spacing */}
                <SegmentGroup
                  label={t("a11y.letterSpacing")}
                  value={settings.letterSpacing}
                  options={lineHeightOptions.map((o) => ({ ...o, icon: MoveHorizontal }))}
                  onChange={(v) => updateSetting("letterSpacing", v)}
                />

                <p className="rounded-2xl border border-beige-dark/20 bg-beige/30 px-3 py-2.5 text-xs leading-relaxed text-coffee/60 dark:border-white/10 dark:bg-white/5 dark:text-warm-white/50">
                  {t("a11y.screenReaderNote")}
                </p>
              </div>

              {/* Footer reset */}
              <div className="border-t border-beige-dark/20 p-4 dark:border-white/10">
                <button
                  type="button"
                  onClick={resetAll}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-beige-dark/30 bg-beige/40 py-3 text-sm font-semibold text-coffee transition-colors hover:bg-beige dark:border-white/10 dark:bg-white/5 dark:text-warm-white"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {t("a11y.reset")}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
