function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadLedgerWorkbook(filename: string, sheets: { name: string; rows: (string | number)[][] }[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || "ledger", { views: [{ rightToLeft: true }] });
    for (const row of sheet.rows) worksheet.addRow(row);
    const header = worksheet.getRow(1);
    header.font = { bold: true };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export async function downloadLedgerPdf(filename: string, title: string, rows: (string | number)[][]) {
  const host = document.createElement("div");
  host.dir = "rtl";
  host.style.cssText = "position:fixed;left:-12000px;top:0;width:794px;background:#fff;color:#1c140f;padding:24px;font-family:Arial,sans-serif;";
  const body = rows
    .map(
      (row, index) =>
        `<tr>${row
          .map((cell) => `<${index === 0 ? "th" : "td"} style="border:1px solid #e6dcc8;padding:4px 6px;font-size:12px;text-align:right">${escapeHtml(String(cell))}</${index === 0 ? "th" : "td"}>`)
          .join("")}</tr>`
    )
    .join("");
  host.innerHTML = `<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1><table style="border-collapse:collapse;width:100%">${body}</table>`;
  document.body.appendChild(host);
  try {
    const html2canvas = (await import("html2canvas-pro")).default;
    const { default: jsPDF } = await import("jspdf");
    const canvas = await html2canvas(host, { scale: 2, backgroundColor: "#ffffff", logging: false });
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = 210;
    const pageHeight = 297;
    const imageHeight = (canvas.height * pageWidth) / canvas.width;
    const image = canvas.toDataURL("image/jpeg", 0.92);
    let left = imageHeight;
    let position = 0;
    pdf.addImage(image, "JPEG", 0, position, pageWidth, imageHeight);
    left -= pageHeight;
    while (left > 0) {
      position = left - imageHeight;
      pdf.addPage();
      pdf.addImage(image, "JPEG", 0, position, pageWidth, imageHeight);
      left -= pageHeight;
    }
    pdf.save(filename);
  } finally {
    host.remove();
  }
}
