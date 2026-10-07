"use client";

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { A4_HEIGHT_MM, A4_HEIGHT_PX, A4_WIDTH_MM, A4_WIDTH_PX } from "@/lib/pdf-menu/a4";
import { preparePdfExportNode } from "@/lib/pdf-menu/pdf-safe-color";
import { waitForFonts, waitForImages, waitTwoFrames } from "@/lib/pdf-menu/wait-for-export";
import { buildReportCopy } from "@/lib/reports/pdf/copy";
import { reportPdfFilename } from "@/lib/reports/pdf/filename";
import { paginateReport } from "@/lib/reports/pdf/paginate";
import type { ReportFilters, ReportPayload } from "@/lib/reports/types";
import { ReportA4Pages } from "@/features/admin/reports/pdf/report-pages";

const MIN_PDF_BYTES = 2500;

type Translate = (key: string) => string;

function createExportHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("data-report-pdf-host", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;background:#fff;";
  document.body.appendChild(host);
  return host;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<string> {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.93);
  if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("REPORT_PDF_CANVAS_FAILED");
  return dataUrl;
}

async function capturePage(el: HTMLElement, landscape: boolean): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas-pro")).default;
  preparePdfExportNode(el);
  const width = landscape ? A4_HEIGHT_PX : A4_WIDTH_PX;
  const height = landscape ? A4_WIDTH_PX : A4_HEIGHT_PX;
  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    logging: false,
    imageTimeout: 2000,
    foreignObjectRendering: false,
  });
}

export async function buildReportPdfBlob(
  payload: ReportPayload,
  filters: ReportFilters,
  t: Translate
): Promise<{ blob: Blob; filename: string; pageCount: number }> {
  const copy = buildReportCopy(payload, filters, t);
  const pages = paginateReport(payload);
  const host = createExportHost();
  let root: Root | null = null;
  try {
    root = createRoot(host);
    flushSync(() => {
      root!.render(<ReportA4Pages pages={pages} payload={payload} copy={copy} />);
    });
    await waitForFonts();
    await waitForImages(host);
    await waitTwoFrames();

    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-report-page='true']"));
    if (!nodes.length) throw new Error("REPORT_PDF_NO_PAGES");

    const { default: jsPDF } = await import("jspdf");
    const orientation = pages[0]?.orientation ?? "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
    const widthMm = orientation === "landscape" ? A4_HEIGHT_MM : A4_WIDTH_MM;
    const heightMm = orientation === "landscape" ? A4_WIDTH_MM : A4_HEIGHT_MM;

    for (let i = 0; i < nodes.length; i++) {
      const canvas = await capturePage(nodes[i]!, orientation === "landscape");
      const dataUrl = await canvasToJpeg(canvas);
      if (i > 0) pdf.addPage([A4_WIDTH_MM, A4_HEIGHT_MM], orientation);
      pdf.addImage(dataUrl, "JPEG", 0, 0, widthMm, heightMm, undefined, "FAST");
    }

    const blob = pdf.output("blob");
    if (!(blob instanceof Blob) || blob.size < MIN_PDF_BYTES) {
      throw new Error(`REPORT_PDF_TOO_SMALL:${blob?.size ?? 0}`);
    }
    return { blob, filename: reportPdfFilename(payload.type), pageCount: nodes.length };
  } finally {
    try {
      root?.unmount();
    } catch {
      /* ignore */
    }
    host.remove();
  }
}

export async function downloadReportPdf(
  payload: ReportPayload,
  filters: ReportFilters,
  t: Translate
): Promise<{ filename: string; pageCount: number }> {
  const result = await buildReportPdfBlob(payload, filters, t);
  downloadBlob(result.blob, result.filename);
  return { filename: result.filename, pageCount: result.pageCount };
}

export async function printReportPdf(
  payload: ReportPayload,
  filters: ReportFilters,
  t: Translate
): Promise<void> {
  const { blob } = await buildReportPdfBlob(payload, filters, t);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.src = url;
  document.body.appendChild(frame);
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    window.setTimeout(() => reject(new Error("REPORT_PDF_PRINT_TIMEOUT")), 15000);
  }).finally(() => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  });
}
