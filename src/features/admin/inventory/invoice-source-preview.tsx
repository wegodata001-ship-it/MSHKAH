"use client";

import { useState } from "react";
import { useT } from "@/components/providers/locale-provider";
import type { InvoiceSourceFile } from "@/lib/inventory/types";

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
  const [zoom, setZoom] = useState(1);
  const url = source?.downloadUrl || fallbackUrl;
  const kind = source?.kind;
  const name = source?.originalFilename || fileName || t("admin.inventory.smart.original");
  if (!url) {
    return <p className="text-sm text-coffee/55">{t("admin.inventory.archive.noSource")}</p>;
  }
  const pdf = kind === "pdf" || name.toLowerCase().endsWith(".pdf");
  return (
    <div className="min-w-0 space-y-2 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-coffee/55">{name}</p>
        <div className="flex gap-2 text-xs">
          <a href={url} target="_blank" rel="noreferrer" className="text-turquoise">
            {t("admin.inventory.archive.viewSource")}
          </a>
          <a href={url} download={name} className="text-turquoise">
            {t("admin.inventory.archive.downloadSource")}
          </a>
          {!pdf && (
            <button type="button" className="text-coffee/60" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              +
            </button>
          )}
          {!pdf && (
            <button type="button" className="text-coffee/60" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              −
            </button>
          )}
        </div>
      </div>
      {pdf ? (
        <iframe title={name} src={url} className="h-[420px] w-full rounded-xl border bg-white" />
      ) : (
        <div className="overflow-auto rounded-xl border bg-beige/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }} className="mx-auto max-w-full" />
        </div>
      )}
    </div>
  );
}
