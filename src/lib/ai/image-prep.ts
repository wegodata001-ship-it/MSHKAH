import sharp from "sharp";

/**
 * Phone-photo preparation for OCR / Gemini extraction.
 *
 * Why this exists:
 *   Invoice scans fail silently when a phone camera stores the image in a
 *   non-upright EXIF orientation (very common with WhatsApp forwards and
 *   Hebrew device defaults). The browser renders the image rotated using
 *   that EXIF flag, but when the raw bytes are POSTed to the model the
 *   model sees the un-rotated pixels — the invoice is sideways and the
 *   extraction returns no supplier, no number, no lines.
 *
 *   We normalise the file *before* calling the model:
 *     1. Detect the real MIME type from the magic bytes (fail-safe for
 *        WhatsApp blobs that lie about their extension).
 *     2. Rotate the pixels to orientation=1 (upright) and strip the EXIF
 *        rotation flag so the saved bytes and the pixels agree.
 *     3. Downscale images that are extravagantly large so the request body
 *        is predictable, while keeping enough resolution to read lines.
 *     4. Leave PDFs untouched — they're already position-independent.
 *
 * All of this is best-effort; if sharp can't open the buffer we fall back
 * to the original bytes rather than failing the whole scan.
 */

export type SniffedMime = "application/pdf" | "image/jpeg" | "image/png" | null;

const MAX_LONG_EDGE = 2600; // enough to read Hebrew invoice line fonts at 300dpi
const MAX_OUTPUT_BYTES = 7 * 1024 * 1024;

/** Reads the first 8 bytes and returns the real MIME, or `null` if unknown. */
export function sniffImageOrPdfMime(bytes: Buffer): SniffedMime {
  if (bytes.length < 4) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  // PDF: 25 50 44 46 ("%PDF")
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  return null;
}

export type PreparedImage = {
  bytes: Buffer;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  width?: number;
  height?: number;
  rotated: boolean;
  resized: boolean;
  reencoded: boolean;
  originalBytes: number;
  originalMimeType: string;
};

/**
 * Return a buffer ready for OCR. Images are rotated to upright and may be
 * downscaled; PDFs are passed through unchanged.
 *
 * This never throws — on any sharp failure the original buffer is
 * returned with the sniffed MIME, so an older encoder that confuses sharp
 * still gets a chance at the model.
 */
export async function prepareInvoiceImage(
  input: { bytes: Buffer; declaredMime: string; filename: string }
): Promise<PreparedImage> {
  const sniffed = sniffImageOrPdfMime(input.bytes);
  // Trust the magic bytes above the claimed MIME. WhatsApp images are often
  // labelled `application/octet-stream` or re-named `.pdf` when forwarded.
  const effectiveMime: PreparedImage["mimeType"] =
    sniffed ??
    (input.declaredMime === "application/pdf" ||
    input.filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : input.declaredMime === "image/png" ||
        input.filename.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg");

  if (effectiveMime === "application/pdf") {
    return {
      bytes: input.bytes,
      mimeType: "application/pdf",
      rotated: false,
      resized: false,
      reencoded: false,
      originalBytes: input.bytes.length,
      originalMimeType: input.declaredMime,
    };
  }

  try {
    const image = sharp(input.bytes, { failOn: "none" });
    const meta = await image.metadata();
    const orientation = typeof meta.orientation === "number" ? meta.orientation : 1;
    const needsRotate = orientation > 1;
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const needsResize = longEdge > MAX_LONG_EDGE;

    if (!needsRotate && !needsResize && input.bytes.length <= MAX_OUTPUT_BYTES) {
      return {
        bytes: input.bytes,
        mimeType: effectiveMime,
        width: meta.width,
        height: meta.height,
        rotated: false,
        resized: false,
        reencoded: false,
        originalBytes: input.bytes.length,
        originalMimeType: input.declaredMime,
      };
    }

    // `.rotate()` with no argument applies the EXIF orientation and strips
    // the tag. This is the safest way to normalise phone photos.
    let pipeline = image.rotate();
    if (needsResize) {
      pipeline = pipeline.resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    // JPEG is tighter than PNG for photos; convert PNG screenshots to JPEG
    // only when the resulting file would be visibly smaller.
    const asJpeg = effectiveMime === "image/jpeg";
    const output = asJpeg
      ? await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });

    return {
      bytes: output.data,
      mimeType: asJpeg ? "image/jpeg" : "image/png",
      width: output.info.width,
      height: output.info.height,
      rotated: needsRotate,
      resized: needsResize,
      reencoded: true,
      originalBytes: input.bytes.length,
      originalMimeType: input.declaredMime,
    };
  } catch {
    // Fall back to the raw bytes. The model will usually still read the
    // invoice if the orientation happens to be upright already.
    return {
      bytes: input.bytes,
      mimeType: effectiveMime,
      rotated: false,
      resized: false,
      reencoded: false,
      originalBytes: input.bytes.length,
      originalMimeType: input.declaredMime,
    };
  }
}
