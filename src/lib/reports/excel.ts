import type { ReportPayload } from "@/lib/reports/types";
import { formatReportDate, formatReportIls } from "@/lib/reports/format";

export async function downloadReportExcel(payload: ReportPayload, title: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31));

  if (payload.type === "inventory" && payload.inventory) {
    sheet.addRow(["קטגוריה", "מוצר", "יחידה", "פתיחה", "כניסות", "צריכה", "התאמות", "נוכחי", "מינימום", "מומלץ", "להזמנה", "ספק אחרון", "מחיר אחרון", "שווי"]);
    for (const row of payload.inventory) {
      sheet.addRow([
        row.category,
        row.name,
        row.unit,
        row.opening,
        row.incoming,
        row.consumption,
        row.adjustments,
        row.current,
        row.minStock,
        row.recommended,
        row.toOrder,
        row.lastSupplier,
        row.lastPrice,
        row.stockValue,
      ]);
    }
  } else if (payload.type === "exceptions" && payload.exceptions) {
    sheet.addRow(["מוצר", "מצב", "נוכחי", "מינימום", "פער", "ספק", "מחיר אחרון", "פעולה"]);
    for (const row of payload.exceptions) {
      sheet.addRow([row.name, row.kind, row.current, row.minStock, row.gap, row.supplier, row.lastPrice, row.action]);
    }
  } else if (payload.type === "blank-count" && payload.blank) {
    sheet.addRow(["קטגוריה", "מוצר", "יחידה", "כמות בפועל", "הערה"]);
    for (const row of payload.blank) {
      sheet.addRow([row.category, row.name, row.unit, "", ""]);
    }
  } else if (payload.type === "count-consumption" && payload.counts) {
    sheet.addRow(["מוצר", "פתיחה", "כניסות", "צריכה", "צפוי", "בפועל", "פער", "סטייה %"]);
    for (const row of payload.counts) {
      sheet.addRow([row.name, row.opening, row.incoming, row.theoretical, row.expected, row.actual, row.gap, row.deviation]);
    }
  } else if (payload.type === "purchases" && payload.purchases) {
    sheet.addRow(["תאריך", "ספק", "חשבונית", "מוצר", "כמות", "יחידה", "מחיר יחידה", "לפני מע״מ", "מע״מ", "כולל מע״מ"]);
    for (const row of payload.purchases) {
      sheet.addRow([
        formatReportDate(row.date),
        row.supplier,
        row.invoice,
        row.product,
        row.quantity,
        row.unit,
        row.unitPrice,
        row.beforeVat,
        row.vat,
        row.includingVat,
      ]);
    }
    if (payload.purchaseSummary) {
      sheet.addRow([]);
      sheet.addRow(["סה״כ כולל", formatReportIls(payload.purchaseSummary.totalIncluding)]);
    }
    if (payload.priceCompare?.length) {
      const compare = workbook.addWorksheet("השוואת מחירים");
      compare.addRow(["מוצר", "ספק", "מחיר יחידה", "הזול ביותר"]);
      for (const item of payload.priceCompare) {
        for (const offer of item.offers) {
          compare.addRow([item.name, offer.supplierName, offer.unitCost, offer.supplierId === item.cheapestSupplierId ? "כן" : ""]);
        }
      }
    }
  } else if (payload.type === "breakeven" && payload.breakEven) {
    const data = payload.breakEven;
    sheet.addRow(["שדה", "ערך"]);
    sheet.addRow(["מחזור", data.revenue]);
    sheet.addRow(["הוצאות קבועות", data.fixedMonthly]);
    sheet.addRow(["הוצאות משתנות", data.variableTotal]);
    sheet.addRow(["Food Cost", data.foodCost]);
    sheet.addRow(["Contribution Margin", data.contribution]);
    sheet.addRow(["נקודת איזון", data.breakEvenMonthly]);
    sheet.addRow(["פער", data.gap]);
    sheet.addRow(["תחזית", data.forecast]);
    sheet.addRow(["הזמנות", data.orders]);
    sheet.addRow(["ממוצע הזמנה", data.averageOrderValue]);
  } else if (payload.type === "supplier-compare" && payload.priceCompare) {
    sheet.addRow(["מוצר", "ספק", "אריזה", "מחיר", "מחיר מנורמל", "הצעה טובה ביותר"]);
    for (const item of payload.priceCompare) {
      for (const offer of item.offers) {
        sheet.addRow([
          item.name,
          offer.supplierName,
          `${offer.packageQty ?? ""} ${offer.unit ?? ""}`.trim(),
          offer.price,
          offer.unitCost,
          offer.supplierId === item.cheapestSupplierId ? "כן" : "",
        ]);
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
