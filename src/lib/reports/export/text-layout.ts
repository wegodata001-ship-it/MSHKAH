import bidiFactory from "bidi-js";
import type { PDFFont, PDFPage } from "pdf-lib";
import { beginText, endText, setFillingRgbColor, setFontAndSize, setTextMatrix, showText } from "pdf-lib/cjs/api/operators";

const bidi = bidiFactory();

export type Rgb = { r: number; g: number; b: number };

export function textWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of source.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(font, next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (textWidth(font, word, size) <= maxWidth) {
      current = word;
      continue;
    }
    current = "";
    let chunk = "";
    for (const char of Array.from(word)) {
      const trial = chunk + char;
      if (textWidth(font, trial, size) <= maxWidth) chunk = trial;
      else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Places each logical character at its visual X. Emission stays in logical order so the PDF text is searchable. */
export function logicalPositions(text: string, font: PDFFont, size: number, rightX: number): { char: string; x: number }[] {
  const chars = Array.from(text);
  const widths = chars.map((char) => textWidth(font, char, size));
  const levels = bidi.getEmbeddingLevels(text, "rtl");
  const visual = chars.map((_, index) => index);
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    let left = start;
    let right = end;
    while (left < right) {
      const swap = visual[left]!;
      visual[left] = visual[right]!;
      visual[right] = swap;
      left += 1;
      right -= 1;
    }
  }
  const placed = new Array<{ char: string; x: number }>(chars.length);
  const total = widths.reduce((sum, width) => sum + width, 0);
  let cursor = rightX - total;
  for (const logicalIndex of visual) {
    placed[logicalIndex] = { char: chars[logicalIndex] ?? "", x: cursor };
    cursor += widths[logicalIndex] ?? 0;
  }
  return placed;
}

export function drawLogicalText(page: PDFPage, font: PDFFont, text: string, rightX: number, baseline: number, size: number, color: Rgb): number {
  const placed = logicalPositions(text, font, size, rightX);
  if (!placed.length) return 0;
  const ops = [beginText(), setFontAndSize(font.name, size), setFillingRgbColor(color.r, color.g, color.b)];
  for (const glyph of placed) {
    if (!glyph?.char) continue;
    ops.push(setTextMatrix(1, 0, 0, 1, glyph.x, baseline));
    try {
      ops.push(showText(font.encodeText(glyph.char)));
    } catch {
      ops.push(showText(font.encodeText("?")));
    }
  }
  ops.push(endText());
  page.pushOperators(...ops);
  return placed.reduce((sum, glyph) => sum + textWidth(font, glyph.char, size), 0);
}
