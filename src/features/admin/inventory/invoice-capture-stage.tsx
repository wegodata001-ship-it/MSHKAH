"use client";

import { useRef, useState } from "react";
import { Camera, FileUp, Loader2, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminCard } from "@/features/admin/components/admin-card";
import { useT } from "@/components/providers/locale-provider";

type Page = { id: string; file: File; url: string; rotation: number };

export function InvoiceCaptureStage({
  busy,
  phaseLabel,
  error,
  onScan,
  onClose,
  onManual,
}: {
  busy: boolean;
  phaseLabel: string;
  error: string | null;
  onScan: (file: File) => void;
  onClose: () => void;
  onManual: () => void;
}) {
  const t = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [active, setActive] = useState(0);
  const [trim, setTrim] = useState(0);
  const [preparing, setPreparing] = useState(false);

  const addFiles = (list: FileList | null, replace: boolean) => {
    if (!list?.length) return;
    const next = Array.from(list).filter((file) => file.type.startsWith("image/") || file.type === "application/pdf" || /\.(jpe?g|png|pdf)$/i.test(file.name));
    if (!next.length) return;
    if (next.some((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      const pdf = next.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))!;
      setPages([{ id: crypto.randomUUID(), file: pdf, url: "", rotation: 0 }]);
      setActive(0);
      return;
    }
    const mapped = next.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), rotation: 0 }));
    setPages((current) => {
      const base = replace ? [] : current.filter((page) => page.url);
      if (replace) current.forEach((page) => page.url && URL.revokeObjectURL(page.url));
      const combined = [...base, ...mapped];
      setActive(combined.length - 1);
      return combined;
    });
  };

  const page = pages[active];
  const isPdf = Boolean(page && !page.url);

  const rotate = () => {
    setPages((current) => current.map((item, index) => (index === active ? { ...item, rotation: (item.rotation + 90) % 360 } : item)));
  };

  const removePage = () => {
    setPages((current) => {
      const target = current[active];
      if (target?.url) URL.revokeObjectURL(target.url);
      const next = current.filter((_, index) => index !== active);
      setActive(Math.max(0, active - 1));
      return next;
    });
  };

  const scan = async () => {
    if (!pages.length || preparing) return;
    setPreparing(true);
    try {
      const file = pages.length === 1 && pages[0].rotation === 0 && trim === 0
        ? pages[0].file
        : await composeInvoiceFile(pages, trim);
      onScan(file);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <AdminCard title={t("admin.inventory.smart.title")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-turquoise px-4 text-base font-semibold text-warm-white"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-7 w-7" />
          {t("admin.inventory.smart.camera")}
        </button>
        <button
          type="button"
          className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-beige-dark/30 bg-warm-white px-4 text-base font-semibold text-dark-brown"
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="h-7 w-7" />
          {t("admin.invoice.capture.pick")}
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files, false);
          event.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files, true);
          event.target.value = "";
        }}
      />
      <p className="mt-3 text-sm text-coffee/65">{t("admin.invoice.capture.fallback")}</p>

      {page && (
        <div className="mt-4 space-y-3">
          {isPdf ? (
            <p className="rounded-xl bg-beige/50 px-3 py-3 text-base">{page.file.name}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={page.url}
              alt={t("admin.invoice.capture.preview")}
              className="mx-auto max-h-80 rounded-2xl border object-contain"
              style={{ transform: `rotate(${page.rotation}deg)` }}
            />
          )}
          <p className="text-sm font-medium">{t("admin.invoice.capture.pages").replace("{count}", String(pages.length))}</p>
          {!isPdf && pages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {pages.map((item, index) => (
                <button key={item.id} type="button" onClick={() => setActive(index)} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" className={`h-16 w-16 rounded-lg border object-cover ${index === active ? "border-turquoise" : "border-beige-dark/30"}`} />
                </button>
              ))}
            </div>
          )}
          {!isPdf && (
            <label className="block text-sm">
              {t("admin.invoice.capture.trim")}
              <input type="range" min={0} max={12} value={trim} onChange={(event) => setTrim(Number(event.target.value))} className="mt-1 w-full" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => cameraRef.current?.click()}>{t("admin.invoice.capture.addPage")}</Button>
            {!isPdf && <Button type="button" variant="outline" className="min-h-11" onClick={rotate}><RotateCw className="h-4 w-4" />{t("admin.invoice.capture.rotate")}</Button>}
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { setPages([]); cameraRef.current?.click(); }}>{t("admin.invoice.capture.retake")}</Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={removePage}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {(busy || preparing) && (
        <p className="mt-3 inline-flex items-center gap-2 text-base text-coffee/80">
          <Loader2 className="h-4 w-4 animate-spin" />
          {preparing ? t("admin.invoice.capture.preparing") : phaseLabel}
        </p>
      )}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onManual}>{t("admin.inventory.smart.manual")}</Button>
        <Button type="button" variant="turquoise" className="min-h-12 px-5 text-base" disabled={busy || preparing || !pages.length} onClick={() => void scan()}>
          {t("admin.invoice.capture.scan")}
        </Button>
      </div>
    </AdminCard>
  );
}

async function composeInvoiceFile(pages: Page[], trimPercent: number): Promise<File> {
  const images = await Promise.all(pages.filter((page) => page.url).map((page) => drawPage(page, trimPercent)));
  if (!images.length) return pages[0].file;
  const width = Math.min(1600, Math.max(...images.map((image) => image.width)));
  const scaled = images.map((image) => ({ image, height: Math.round(image.height * (width / image.width)) }));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = scaled.reduce((sum, item) => sum + item.height, 0);
  const ctx = canvas.getContext("2d");
  if (!ctx) return pages[0].file;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const item of scaled) {
    ctx.drawImage(item.image, 0, y, width, item.height);
    y += item.height;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) return pages[0].file;
  return new File([blob], "invoice.jpg", { type: "image/jpeg" });
}

function drawPage(page: Page, trimPercent: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const trimX = Math.round(image.width * (trimPercent / 100));
      const trimY = Math.round(image.height * (trimPercent / 100));
      const sourceWidth = Math.max(1, image.width - trimX * 2);
      const sourceHeight = Math.max(1, image.height - trimY * 2);
      const quarter = page.rotation % 180 !== 0;
      const canvas = document.createElement("canvas");
      canvas.width = quarter ? sourceHeight : sourceWidth;
      canvas.height = quarter ? sourceWidth : sourceHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((page.rotation * Math.PI) / 180);
      ctx.drawImage(image, trimX, trimY, sourceWidth, sourceHeight, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("image"));
    image.src = page.url;
  });
}
