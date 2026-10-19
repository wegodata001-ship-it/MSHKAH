import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  prepareInvoiceImage,
  sniffImageOrPdfMime,
} from "@/lib/ai/image-prep";

describe("sniffImageOrPdfMime", () => {
  it("detects JPEG magic bytes", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffImageOrPdfMime(bytes)).toBe("image/jpeg");
  });

  it("detects PNG magic bytes", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageOrPdfMime(bytes)).toBe("image/png");
  });

  it("detects PDF magic bytes", () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(sniffImageOrPdfMime(bytes)).toBe("application/pdf");
  });

  it("returns null for unknown bytes", () => {
    const bytes = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(sniffImageOrPdfMime(bytes)).toBe(null);
  });

  it("returns null for empty buffer", () => {
    expect(sniffImageOrPdfMime(Buffer.alloc(0))).toBe(null);
  });
});

describe("prepareInvoiceImage", () => {
  it("passes PDFs through untouched", async () => {
    const pdfHeader = Buffer.from("%PDF-1.4\n%ignored\n", "utf8");
    const result = await prepareInvoiceImage({
      bytes: pdfHeader,
      declaredMime: "application/pdf",
      filename: "invoice.pdf",
    });
    expect(result.mimeType).toBe("application/pdf");
    expect(result.rotated).toBe(false);
    expect(result.reencoded).toBe(false);
    expect(result.bytes).toBe(pdfHeader);
  });

  it("rotates a JPEG with EXIF orientation=6 to upright", async () => {
    // Build a 20x10 image with orientation=6 (clockwise 90°). After prep the
    // output should be upright, so width/height swap: 10x20.
    const upright = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await prepareInvoiceImage({
      bytes: upright,
      declaredMime: "image/jpeg",
      filename: "photo.jpg",
    });

    expect(result.rotated).toBe(true);
    expect(result.reencoded).toBe(true);
    // sharp rotates to true pixel upright: 20×10 landscape with EXIF 6
    // becomes a 10×20 portrait after .rotate().
    expect(result.width).toBe(10);
    expect(result.height).toBe(20);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("leaves an already-upright JPEG alone", async () => {
    const upright = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const result = await prepareInvoiceImage({
      bytes: upright,
      declaredMime: "image/jpeg",
      filename: "photo.jpg",
    });

    expect(result.rotated).toBe(false);
    expect(result.resized).toBe(false);
    expect(result.reencoded).toBe(false);
    expect(result.bytes).toBe(upright);
  });

  it("downscales oversize images to the configured long edge", async () => {
    const huge = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg({ quality: 80 })
      .toBuffer();

    const result = await prepareInvoiceImage({
      bytes: huge,
      declaredMime: "image/jpeg",
      filename: "photo.jpg",
    });

    expect(result.resized).toBe(true);
    expect(result.reencoded).toBe(true);
    expect(result.width ?? 0).toBeLessThanOrEqual(2600);
    expect(result.height ?? 0).toBeLessThanOrEqual(2600);
    expect(result.bytes.length).toBeLessThan(huge.length);
  });

  it("falls back to the raw buffer if sharp cannot open the file", async () => {
    // Non-image bytes with image/jpeg declared MIME. The magic bytes don't
    // match, so sharp will reject it. The function must still return a
    // defined result and keep the raw bytes.
    const bogus = Buffer.from("not an image at all", "utf8");
    const result = await prepareInvoiceImage({
      bytes: bogus,
      declaredMime: "image/jpeg",
      filename: "fake.jpg",
    });
    expect(result.rotated).toBe(false);
    expect(result.reencoded).toBe(false);
    expect(result.bytes).toBe(bogus);
  });
});
