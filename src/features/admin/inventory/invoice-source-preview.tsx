"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Expand, Minus, Plus, X } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import type { InvoiceSourceFile } from "@/lib/inventory/types";

const PREVIEW_FRAME =
  "flex h-[150px] max-h-[150px] w-full items-center justify-center overflow-hidden rounded-xl border border-beige-dark/15 bg-beige/20 md:h-[220px] md:max-h-[220px]";

export function InvoiceSourcePreview({
  source,
  fallbackUrl,
  fileName,
}: {
  source?: InvoiceSourceFile | null;
  fallbackUrl?: string | null;
  fileName?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const url = source?.downloadUrl || fallbackUrl;
  const kind = source?.kind;
  const name = source?.originalFilename || fileName || t("admin.inventory.smart.original");
  const pdf = kind === "pdf" || name.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    if (!open) {
      setZoom(1);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!url) {
    return <p className="text-sm text-coffee/55">{t("admin.inventory.archive.noSource")}</p>;
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-coffee/55">{name}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="inline-flex items-center gap-1 text-turquoise" onClick={() => setOpen(true)}>
            <Expand className="h-3.5 w-3.5" />
            {t("admin.inventory.smart.enlargeSource")}
          </button>
          <a href={url} download={name} className="text-turquoise">
            {t("admin.inventory.archive.downloadSource")}
          </a>
        </div>
      </div>
      <div
        role="button"
        tabIndex={0}
        className={`${PREVIEW_FRAME} cursor-zoom-in`}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={t("admin.inventory.smart.enlargeSource")}
      >
        {pdf ? (
          <iframe title={name} src={url} className="pointer-events-none h-full w-full bg-white" tabIndex={-1} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        )}
      </div>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[1100] flex flex-col bg-black/70 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={name}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-white">
              <p className="min-w-0 truncate text-sm font-medium">{name}</p>
              <div className="flex flex-wrap items-center gap-2">
                {!pdf && (
                  <>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"
                      onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}
                      aria-label={t("admin.inventory.smart.zoomOut")}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"
                      onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}
                      aria-label={t("admin.inventory.smart.zoomIn")}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </>
                )}
                <a href={url} download={name} className="rounded-lg bg-white/15 px-3 py-2 text-xs">
                  {t("admin.inventory.archive.downloadSource")}
                </a>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1 rounded-lg bg-white px-3 text-sm font-medium text-dark-brown"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                  {t("common.close")}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto rounded-xl bg-black/30">
              {pdf ? (
                <iframe title={name} src={url} className="h-[80vh] w-full rounded-xl bg-white" />
              ) : (
                <div className="flex h-full items-start justify-center p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="max-w-none object-contain"
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top center",
                      maxHeight: zoom === 1 ? "min(80vh, 900px)" : "none",
                      width: "auto",
                    }}
                  />
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
