"use client";

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { PDFDocument, type PDFImage } from "pdf-lib";
import { preparePdfExportNode } from "@/lib/pdf-menu/pdf-safe-color";
import { A4_HEIGHT_MM, A4_HEIGHT_PX, A4_WIDTH_MM, A4_WIDTH_PX } from "@/lib/pdf-menu/a4";
import { waitForFonts, waitForImages, waitTwoFrames } from "@/lib/pdf-menu/wait-for-export";
import { layoutInvoicePages, type InvoiceDocument } from "@/lib/inventory/invoice-document";
import { InvoicePdfPages } from "@/features/admin/inventory/invoice-pdf-pages";

export type InvoiceSourceBytes = {
  mimeType: string;
  filename?: string | null;
  bytes: Uint8Array;
};

export async function buildInvoicePdfBlob(doc: InvoiceDocument, source?: InvoiceSourceBytes | null): Promise<Blob> {
  const pages = layoutInvoicePages(doc);
  const host = document.createElement("div");
  host.setAttribute("data-invoice-pdf-host", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;background:#fff;";
  document.body.appendChild(host);
  let root: Root | null = null;
  try {
    root = createRoot(host);
    flushSync(() => {
      root!.render(<InvoicePdfPages doc={doc} pages={pages} />);
    });
    await waitForFonts();
    await waitForImages(host);
    await waitTwoFrames();
    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-invoice-page='true']"));
    if (!nodes.length) throw new Error("INVOICE_PDF_NO_PAGES");
    const { default: jsPDF } = await import("jspdf");
    const html2canvas = (await import("html2canvas-pro")).default;
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < nodes.length; i++) {
      preparePdfExportNode(nodes[i]!);
      const canvas = await html2canvas(nodes[i]!, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        width: A4_WIDTH_PX,
        height: A4_HEIGHT_PX,
        windowWidth: A4_WIDTH_PX,
        windowHeight: A4_HEIGHT_PX,
        logging: false,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, "FAST");
    }
    const generated = pdf.output("arraybuffer");
    const merged = await appendSource(generated, source);
    return new Blob([toArrayBuffer(merged)], { type: "application/pdf" });
  } finally {
    try {
      root?.unmount();
    } catch {
      /* ignore */
    }
    host.remove();
  }
}

async function appendSource(generated: ArrayBuffer, source?: InvoiceSourceBytes | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(generated);
  if (!source?.bytes?.length) return pdf.save();
  const mime = source.mimeType.toLowerCase();
  try {
    if (mime.includes("pdf")) {
      const original = await PDFDocument.load(source.bytes);
      const copied = await pdf.copyPages(original, original.getPageIndices());
      copied.forEach((page) => pdf.addPage(page));
    } else if (mime.includes("png")) {
      const image = await pdf.embedPng(source.bytes);
      drawFit(pdf, image);
    } else if (mime.includes("jpeg") || mime.includes("jpg")) {
      const image = await pdf.embedJpg(source.bytes);
      drawFit(pdf, image);
    }
  } catch {
    return pdf.save();
  }
  return pdf.save();
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function drawFit(pdf: PDFDocument, image: PDFImage) {
  const page = pdf.addPage([595.28, 841.89]);
  const scale = Math.min(515 / image.width, 760 / image.height, 1);
  const size = image.scale(scale);
  page.drawImage(image, {
    x: (595.28 - size.width) / 2,
    y: (841.89 - size.height) / 2,
    width: size.width,
    height: size.height,
  });
}

export function invoicePdfFilename(invoiceNumber: string): string {
  const safe = (invoiceNumber || "invoice").replace(/[^\w\u0590-\u05FF-]+/g, "-");
  return `mishkat-invoice-${safe}.pdf`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export async function printPdfBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.src = url;
  document.body.appendChild(frame);
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("INVOICE_PDF_PRINT_TIMEOUT")), 15000);
    frame.onload = () => {
      window.clearTimeout(timer);
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      resolve();
    };
  }).finally(() => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  });
}
