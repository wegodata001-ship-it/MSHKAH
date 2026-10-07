import { createHash } from "crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { matchProduct } from "@/lib/costing/import/match";
import type { Product } from "@/types";
import type { PosProductMap, PosSaleLine } from "@/lib/inventory/types";

const MAX_BYTES = 4 * 1024 * 1024;

const COLS: Record<string, keyof MappedPosRow> = {
  pos_item_code: "posCode",
  pos_code: "posCode",
  item_code: "posCode",
  sku: "posCode",
  barcode: "posCode",
  pos_item_name: "posName",
  pos_name: "posName",
  item_name: "posName",
  name: "posName",
  product: "posName",
  quantity_sold: "quantity",
  qty: "quantity",
  quantity: "quantity",
  unit_price: "unitPrice",
  price: "unitPrice",
  discount: "discount",
  gross_total: "grossTotal",
  net_total: "netTotal",
  total: "netTotal",
  vat: "vat",
  sale_date: "saleDate",
  date: "saleDate",
  order: "reference",
  reference: "reference",
  order_number: "reference",
};

type MappedPosRow = {
  posCode: string;
  posName: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  grossTotal?: number;
  netTotal?: number;
  vat?: number;
  saleDate?: string;
  reference?: string;
};

function headerKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function asText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function asNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function hashPosFile(bytes: Uint8Array, fileName: string): string {
  return createHash("sha256").update(fileName).update(bytes).digest("hex");
}

export function validatePosFile(name: string, size: number, type?: string): string | null {
  if (size <= 0 || size > MAX_BYTES) return "file-size";
  const lower = name.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) return "file-type";
  if (type && !/spreadsheet|excel|csv|octet-stream|empty/i.test(type) && type !== "") return null;
  return null;
}

function mapRow(headers: string[], cells: unknown[]): MappedPosRow | null {
  const row: MappedPosRow = { posCode: "", posName: "", quantity: 0 };
  headers.forEach((header, index) => {
    const field = COLS[header];
    if (!field) return;
    if (field === "posCode" || field === "posName" || field === "saleDate" || field === "reference") {
      row[field] = asText(cells[index]);
    } else {
      const n = asNumber(cells[index]);
      if (n != null) row[field] = n;
    }
  });
  if (!row.posName && !row.posCode) return null;
  if (!row.quantity) return null;
  return row;
}

function toSaleLine(
  row: MappedPosRow,
  index: number,
  products: Product[],
  maps: PosProductMap[]
): PosSaleLine {
  const mapped = maps.find(
    (item) =>
      (row.posCode && item.posCode === row.posCode) ||
      (row.posName && item.posName === row.posName)
  );
  const match = mapped
    ? { item: products.find((product) => product.id === mapped.menuProductId), kind: "exact" as const }
    : matchProduct(row.posCode, row.posName, products);
  return {
    key: `pos-${index}-${row.posCode}-${row.posName}-${row.saleDate ?? ""}`,
    posCode: row.posCode,
    posName: row.posName,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    netTotal: row.netTotal ?? row.grossTotal,
    saleDate: row.saleDate,
    menuProductId: mapped?.menuProductId ?? match.item?.id,
    matchKind: mapped ? "exact" : match.kind === "exact" || match.kind === "suggest" ? match.kind : "none",
  };
}

export async function parsePosBuffer(
  bytes: Buffer,
  fileName: string,
  products: Product[],
  maps: PosProductMap[]
): Promise<{ lines: PosSaleLine[]; fileHash: string }> {
  const fileHash = hashPosFile(bytes, fileName);
  const workbook = new ExcelJS.Workbook();
  if (fileName.toLowerCase().endsWith(".csv")) {
    await workbook.csv.read(Readable.from(bytes));
  } else {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { lines: [], fileHash };
  const headerRow = sheet.getRow(1);
  const headers = (headerRow.values as unknown[]).slice(1).map(headerKey);
  const lines: PosSaleLine[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const cells = (row.values as unknown[]).slice(1);
    const mapped = mapRow(headers, cells);
    if (!mapped) return;
    lines.push(toSaleLine(mapped, lines.length, products, maps));
  });
  return { lines, fileHash };
}
