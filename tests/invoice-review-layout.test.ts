import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("invoice review layout", () => {
  const preview = readFileSync(resolve("src/features/admin/inventory/invoice-source-preview.tsx"), "utf8");
  const flow = readFileSync(resolve("src/features/admin/inventory/smart-invoice-flow.tsx"), "utf8");

  it("caps the source thumbnail and keeps zoom in a lightbox", () => {
    expect(preview).toContain("h-[150px]");
    expect(preview).toContain("md:h-[220px]");
    expect(preview).toContain("max-h-[150px]");
    expect(preview).toContain("md:max-h-[220px]");
    expect(preview).toContain("object-contain");
    expect(preview).toMatch(/const PREVIEW_FRAME =[\s\S]*h-\[150px\][\s\S]*md:h-\[220px\]/);
    expect(preview).not.toMatch(/const PREVIEW_FRAME =[\s\S]*min-h-/);
    expect(preview).not.toContain("h-[420px]");
    expect(preview).toContain("enlargeSource");
    expect(preview).toContain("createPortal");
    expect(preview).toContain("downloadSource");
  });

  it("places compact details, source, then full-width lines in one review card", () => {
    const previewAt = flow.indexOf("<InvoiceSourcePreview");
    const linesAt = flow.indexOf("id=\"invoice-lines\"");
    expect(previewAt).toBeGreaterThan(0);
    expect(linesAt).toBeGreaterThan(previewAt);
    expect(flow).not.toContain("mobileTab");
    expect(flow).not.toContain("sourceTab");
    expect(flow).toContain("<InvoiceLinesReview");
    expect(linesAt).toBeLessThan(flow.lastIndexOf("smart.saveDraft"));
  });
});
