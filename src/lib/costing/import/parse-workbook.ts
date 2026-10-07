import ExcelJS from "exceljs";
import { normalizeImportUnit } from "@/lib/costing/import/normalize-unit";
import type { ParsedIngredientRow, ParsedRecipeRow, ParsedWorkbook } from "@/lib/costing/import/types";

const MAX_BYTES = 2 * 1024 * 1024;
const INGREDIENT_HEADERS: Record<string, string> = {
  ingredient_name: "name",
  name: "name",
  "اسم المكوّن": "name",
  "اسم المكون": "name",
  category: "category",
  فئة: "category",
  קטגוריה: "category",
  supplier: "supplier",
  المورد: "supplier",
  "المورّد": "supplier",
  ספק: "supplier",
  purchase_price: "purchasePrice",
  price: "purchasePrice",
  سعر: "purchasePrice",
  "سعر الشراء": "purchasePrice",
  package_quantity: "packageQuantity",
  quantity: "packageQuantity",
  "كمية العبوة": "packageQuantity",
  purchase_unit: "purchaseUnitRaw",
  unit: "purchaseUnitRaw",
  وحدة: "purchaseUnitRaw",
  "وحدة الشراء": "purchaseUnitRaw",
};

const RECIPE_HEADERS: Record<string, string> = {
  product_name: "productName",
  product: "productName",
  "اسم المنتج": "productName",
  product_id: "productId",
  id: "productId",
  menu_description: "menuDescription",
  description: "menuDescription",
  ingredient_name: "ingredientName",
  quantity: "quantity",
  qty: "quantity",
  unit: "unitRaw",
};

function headerKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function sheetLooksLikeIngredients(headers: string[]): boolean {
  return (
    headers.includes("purchase_price") ||
    headers.includes("package_quantity") ||
    headers.some((h) => h.includes("purchase"))
  );
}

function sheetLooksLikeRecipes(headers: string[]): boolean {
  return (
    headers.includes("product_name") ||
    headers.includes("product_id") ||
    headers.includes("menu_description")
  );
}

function mapIngredientRow(row: number, record: Record<string, unknown>): ParsedIngredientRow {
  const name = asText(record.name);
  const purchasePrice = asNumber(record.purchasePrice);
  const packageQuantity = asNumber(record.packageQuantity);
  const purchaseUnitRaw = asText(record.purchaseUnitRaw);
  const purchaseUnit = normalizeImportUnit(purchaseUnitRaw);
  const errors: string[] = [];
  if (!name) errors.push("missing-name");
  if (purchasePrice == null) errors.push("missing-price");
  else if (purchasePrice < 0) errors.push("negative-price");
  else if (purchasePrice === 0) errors.push("zero-price");
  if (packageQuantity == null) errors.push("missing-package-qty");
  else if (packageQuantity <= 0) errors.push("zero-package-qty");
  if (purchaseUnitRaw && !purchaseUnit) errors.push("unknown-unit");
  if (!purchaseUnitRaw) errors.push("missing-unit");
  return {
    row,
    name,
    category: asText(record.category),
    supplier: asText(record.supplier),
    purchasePrice,
    packageQuantity,
    purchaseUnitRaw,
    purchaseUnit,
    errors,
  };
}

function mapRecipeRow(row: number, record: Record<string, unknown>): ParsedRecipeRow {
  const productName = asText(record.productName);
  const productId = asText(record.productId);
  const ingredientName = asText(record.ingredientName);
  const quantity = asNumber(record.quantity);
  const unitRaw = asText(record.unitRaw);
  const unit = normalizeImportUnit(unitRaw);
  const errors: string[] = [];
  if (!productName && !productId) errors.push("missing-product");
  if (!ingredientName) errors.push("missing-ingredient");
  if (quantity == null) errors.push("missing-qty");
  else if (quantity <= 0) errors.push("invalid-qty");
  if (unitRaw && !unit) errors.push("unknown-unit");
  if (!unitRaw) errors.push("missing-unit");
  return {
    row,
    productName,
    productId,
    menuDescription: asText(record.menuDescription),
    ingredientName,
    quantity,
    unitRaw,
    unit,
    errors,
  };
}

function recordsFromSheet(sheet: ExcelJS.Worksheet, map: Record<string, string>): { row: number; record: Record<string, unknown> }[] {
  const rows: { row: number; record: Record<string, unknown> }[] = [];
  const header = sheet.getRow(1);
  const keys: string[] = [];
  header.eachCell((cell, col) => {
    keys[col] = map[headerKey(cell.value)] ?? "";
  });
  sheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    excelRow.eachCell((cell, col) => {
      const key = keys[col];
      if (key) record[key] = cell.value;
    });
    if (Object.values(record).every((value) => value == null || String(value).trim() === "")) return;
    rows.push({ row: rowNumber, record });
  });
  return rows;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === "," || ch === "\t") && !quoted) {
      row.push(current);
      current = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += ch;
    }
  }
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function parseCsvTable(text: string): ParsedWorkbook {
  const table = parseCsv(text);
  const headers = (table[0] ?? []).map(headerKey);
  const body = table.slice(1);
  const asIngredients = sheetLooksLikeIngredients(headers) && !headers.includes("product_name") && !headers.includes("product_id");
  const map = asIngredients ? INGREDIENT_HEADERS : RECIPE_HEADERS;
  const keys = headers.map((h) => map[h] ?? "");
  if (asIngredients) {
    return {
      fileName: "",
      ingredients: body.map((cells, index) => {
        const record: Record<string, unknown> = {};
        cells.forEach((cell, i) => {
          if (keys[i]) record[keys[i]] = cell;
        });
        return mapIngredientRow(index + 2, record);
      }),
      recipes: [],
      parseErrors: keys.some(Boolean) ? [] : ["unknown-columns"],
    };
  }
  return {
    fileName: "",
    ingredients: [],
    recipes: body.map((cells, index) => {
      const record: Record<string, unknown> = {};
      cells.forEach((cell, i) => {
        if (keys[i]) record[keys[i]] = cell;
      });
      return mapRecipeRow(index + 2, record);
    }),
    parseErrors: keys.some(Boolean) ? [] : ["unknown-columns"],
  };
}

export function validateImportFile(fileName: string, bytes: number, mime?: string): string | null {
  if (bytes <= 0) return "empty-file";
  if (bytes > MAX_BYTES) return "file-too-large";
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsm") || lower.endsWith(".xlsb")) return "macros-not-allowed";
  if (lower.endsWith(".xlsx") || lower.endsWith(".csv")) return null;
  if (mime?.includes("spreadsheet") || mime === "text/csv") return null;
  return "unsupported-type";
}

export async function parseImportBuffer(
  buffer: Buffer,
  fileName: string
): Promise<ParsedWorkbook> {
  const sizeError = validateImportFile(fileName, buffer.byteLength);
  if (sizeError) {
    return { fileName, ingredients: [], recipes: [], parseErrors: [sizeError] };
  }
  if (fileName.toLowerCase().endsWith(".csv")) {
    const parsed = parseCsvTable(buffer.toString("utf8"));
    return { ...parsed, fileName };
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const ingredients: ParsedIngredientRow[] = [];
  const recipes: ParsedRecipeRow[] = [];
  const parseErrors: string[] = [];
  workbook.eachSheet((sheet) => {
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(headerKey(cell.value)));
    const name = sheet.name.toLowerCase();
    if (name.includes("recipe") || name.includes("وص") || name.includes("מתכון") || sheetLooksLikeRecipes(headers)) {
      for (const item of recordsFromSheet(sheet, RECIPE_HEADERS)) {
        recipes.push(mapRecipeRow(item.row, item.record));
      }
      return;
    }
    if (name.includes("ingredient") || name.includes("مكو") || name.includes("מרכיב") || sheetLooksLikeIngredients(headers)) {
      for (const item of recordsFromSheet(sheet, INGREDIENT_HEADERS)) {
        ingredients.push(mapIngredientRow(item.row, item.record));
      }
      return;
    }
    if (headers.some(Boolean)) parseErrors.push(`unknown-sheet:${sheet.name}`);
  });
  return { fileName, ingredients, recipes, parseErrors };
}

export const IMPORT_MAX_BYTES = MAX_BYTES;
