import type { ReportType } from "@/lib/reports/types";

const SLUG: Record<ReportType, string> = {
  inventory: "inventory-report",
  exceptions: "inventory-exceptions",
  "blank-count": "stock-count",
  "count-consumption": "consumption-report",
  purchases: "supplier-purchases",
  "supplier-compare": "supplier-compare",
  breakeven: "break-even",
};

export function reportPdfFilename(type: ReportType, date = new Date()): string {
  return `mishkat-${SLUG[type]}-${date.toISOString().slice(0, 10)}.pdf`;
}

export function reportOrientation(type: ReportType): "portrait" | "landscape" {
  return type === "purchases" ? "landscape" : "portrait";
}
