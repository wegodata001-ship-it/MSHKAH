"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { PWA_APP_NAME } from "@/lib/pwa/config";
import { isPortalHost, isMenuHost } from "@/lib/domains/host-routing";

const INSTALL_DISMISS_KEY = "mshkah-pwa-install-dismissed";

export function PwaManager() {
  const t = useT();
  const [updateReady, setUpdateReady] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    if (isPortalHost(window.location.hostname)) return;
    if (isMenuHost(window.location.hostname)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (cancelled) return;
        registrationRef.current = registration;

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });

        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }
      } catch (error) {
        console.warn("[PWA] service worker registration failed", error);
      }
    };

    void register();

    const onControllerChange = () => {
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void registrationRef.current?.update();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      if (localStorage.getItem(INSTALL_DISMISS_KEY) === "1") return;
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = registrationRef.current?.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
    }
    setUpdateReady(false);
  }, []);

  const dismissInstall = useCallback(() => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    setShowInstall(false);
    setInstallPrompt(null);
  }, []);

  const runInstall = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setShowInstall(false);
  }, [installPrompt]);

  if (!updateReady && !showInstall) return null;

  return (
    <div data-pwa-install className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.75rem)] z-[95] flex justify-center px-4 print:hidden md:bottom-6">
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
        {updateReady && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-beige-dark/25 bg-warm-white/95 px-4 py-3 shadow-elevated backdrop-blur-md">
            <p className="text-sm text-coffee/80">
              {t("pwa.updateAvailable", "עדכון זמין — רענון מומלץ")}
            </p>
            <Button variant="turquoise" size="sm" onClick={applyUpdate}>
              {t("pwa.refresh", "רענן")}
            </Button>
          </div>
        )}
        {showInstall && installPrompt && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-beige-dark/25 bg-warm-white/95 px-4 py-3 shadow-elevated backdrop-blur-md">
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark-brown">
                {t("pwa.installTitle", "התקנת {app}").replace("{app}", PWA_APP_NAME)}
              </p>
              <p className="text-xs text-coffee/55">
                {t("pwa.installHint", "הוסיפו למסך הבית לחוויית אפליקציה מלאה")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="turquoise" size="sm" onClick={() => void runInstall()}>
                <Download className="h-3.5 w-3.5" />
                {t("pwa.install", "התקן")}
              </Button>
              <button
                type="button"
                onClick={dismissInstall}
                aria-label={t("common.close", "Close")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-coffee/45 hover:bg-beige/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}
