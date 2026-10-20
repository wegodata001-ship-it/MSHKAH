import { readFileSync } from "node:fs";
import path from "path";
import ExcelJS from "exceljs";
import type { ReportDocument, ReportValue } from "@/lib/reports/export/types";
import { cellValue, safeCellText } from "@/lib/reports/export/safe";

const BROWN = "FF3D2B24";
const CREAM = "FFF8F3ED";
const TEAL = "FF007A80";

function asDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

export async function renderReportWorkbook(doc: ReportDocument): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MISHKAT CAFÉ";
  workbook.created = new Date();
  let logoId: number | null = null;
  try {
    const logo = readFileSync(path.join(process.cwd(), "public/logo-transparent.png"));
    logoId = workbook.addImage({ buffer: logo as unknown as ExcelJS.Buffer, extension: "png" });
  } catch {
    logoId = null;
  }
  for (const sheet of doc.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || "Report", {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 6 }],
    });
    if (logoId != null) worksheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 42, height: 36 } });
    worksheet.getCell("C1").value = "MISHKAT CAFÉ — משקאת";
    worksheet.getCell("C1").font = { bold: true, color: { argb: BROWN }, size: 16, name: "Calibri" };
    worksheet.getCell("C2").value = safeCellText(doc.title);
    worksheet.getCell("C2").font = { bold: true, color: { argb: TEAL }, size: 13 };
    worksheet.getCell("A4").value = safeCellText(`הופק: ${doc.generatedAt}`);
    worksheet.getCell("C4").value = safeCellText(`תקופה: ${doc.period}`);
    worksheet.getCell("E4").value = safeCellText(`מזהה: ${doc.reportId}`);
    const headerRow = 6;
    sheet.columns.forEach((column, index) => {
      const cell = worksheet.getRow(headerRow).getCell(index + 1);
      cell.value = safeCellText(column.header);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BROWN } };
      cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      worksheet.getColumn(index + 1).width = Math.max(12, (column.width ?? 16) * 1.4);
    });
    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(headerRow + 1 + rowIndex);
      row.forEach((value, index) => writeCell(excelRow.getCell(index + 1), value, sheet.columns[index]?.kind));
      if (rowIndex % 2 === 0) {
        excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
          if (col <= sheet.columns.length) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
        });
      }
    });
    const lastRow = headerRow + Math.max(sheet.rows.length, 1);
    if (sheet.columns.length && sheet.rows.length) {
      worksheet.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: lastRow, column: sheet.columns.length },
      };
    }
    if (sheet.totals && sheet.rows.length) {
      const totalRow = worksheet.getRow(lastRow + 2);
      totalRow.getCell(1).value = "סיכום";
      totalRow.getCell(1).font = { bold: true, color: { argb: TEAL } };
      sheet.columns.forEach((column, index) => {
        if (column.kind !== "money" && column.kind !== "number") return;
        const letter = worksheet.getColumn(index + 1).letter;
        totalRow.getCell(index + 1).value = { formula: `SUM(${letter}${headerRow + 1}:${letter}${lastRow})` };
        totalRow.getCell(index + 1).numFmt = column.kind === "money" ? '#,##0.00" ₪"' : "#,##0.00";
        totalRow.getCell(index + 1).font = { bold: true };
      });
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function writeCell(cell: ExcelJS.Cell, value: ReportValue, kind?: string) {
  const safe = cellValue(value, kind);
  if (safe == null) {
    cell.value = null;
    return;
  }
  if (typeof safe === "number") {
    cell.value = safe;
    if (kind === "money") cell.numFmt = '#,##0.00" ₪"';
    else if (kind === "percent") cell.numFmt = "0.0";
    else cell.numFmt = Number.isInteger(safe) ? "#,##0" : "#,##0.00";
    cell.alignment = { horizontal: "right" };
    return;
  }
  const date = kind === "date" ? asDate(safe) : null;
  if (date) {
    cell.value = date;
    cell.numFmt = "yyyy-mm-dd";
    return;
  }
  cell.value = safe;
  cell.alignment = { horizontal: "right", wrapText: true };
}
