import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import ExcelJS from "exceljs";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { catalogNames, matchProduct } from "../src/lib/costing/import/match";
import { parsePosBuffer } from "../src/lib/inventory/pos-parse";
import { mapProduct } from "../src/lib/mappers";
import type { FirestoreDoc, FirestoreProduct } from "../src/types/firestore";
import type { Product } from "../src/types";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.products).limit(800).get();
  const raw = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>);
  const products = snap.docs.map((doc) =>
    mapProduct({ id: doc.id, ...doc.data() } as FirestoreDoc<FirestoreProduct>)
  );
  const missing = products.filter((item) => catalogNames(item).length === 0);
  const partial = products.filter((item) => {
    const raw = [item.name_ar, item.name_he, item.name_en];
    return raw.some((value) => value == null) && catalogNames(item).length > 0;
  });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("sales");
  [
    ["משקאה"],
    ["תקופה 01/09/2026 - 18/09/2026"],
    [],
    [],
    [],
    ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע"],
    ["חומוס", "", 10, 280, 28],
    ["شاورما", "7290002", 4, 120, 30],
    ["סה״כ", "", 14, 400, ""],
  ].forEach((row) => sheet.addRow(row));
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const ghost = { id: "ghost-missing-names" } as Product;
  const liveSheet = new ExcelJS.Workbook();
  const live = liveSheet.addWorksheet("sales");
  [
    ["משקאה"],
    ["תקופה 01/09/2026 - 18/09/2026"],
    [],
    [],
    [],
    ["שם המוצר", "ברקוד", "כמות מכירה", "סה״כ הכנסות", "מחיר ממוצע"],
    [products[0]?.name_he ?? "יוגרט", "", 2, 20, 10],
    [products[1]?.name_ar ?? "تورتليني", "7290002", 3, 90, 30],
    ["", "729999", 1, 15, 15],
    ["מוצר שלא קיים במערכת", "", 4, 40, 10],
    ["סה״כ", "", 10, 165, ""],
  ].forEach((row) => live.addRow(row));
  const liveBytes = Buffer.from(await liveSheet.xlsx.writeBuffer());
  const parsedRaw = await parsePosBuffer(bytes, "audit-raw.xlsx", raw as unknown as Product[], []);
  const parsed = await parsePosBuffer(liveBytes, "audit-live.xlsx", [...products, ghost], []);
  const sampleRaw = raw[0] ?? {};
  console.log(
    JSON.stringify(
      {
        productCount: products.length,
        rawNameKeys: Object.keys(sampleRaw).filter((key) => /name/i.test(key)),
        mappedNames: products.slice(0, 3).map((item) => ({ id: item.id, name_he: item.name_he, name_ar: item.name_ar })),
        missingAllNames: missing.map((item) => item.id),
        missingOneLocale: partial.length,
        matchEmptyEmpty: matchProduct("", "", products).kind,
        hummusMatch: matchProduct("", "חומוס", products).item?.id ?? null,
        yogurtMatch: matchProduct("", products[0]?.name_he, products).item?.id ?? null,
        tortelliniAr: matchProduct("", products[1]?.name_ar, products).item?.id ?? null,
        emptyAlias: catalogNames({ aliases: [undefined, ""] }).length,
        rawParseLines: parsedRaw.lines.length,
        parsedLines: parsed.lines.length,
        unmatched: parsed.lines.filter((line) => line.matchKind === "none").length,
        missingSource: parsed.lines.filter((line) => line.reviewReason === "missing-source-name").map((line) => line.sourceRow),
        names: parsed.lines.map((line) => ({
          posName: line.posName,
          posCode: line.posCode,
          matchKind: line.matchKind,
          menuProductId: line.menuProductId,
          reviewReason: line.reviewReason ?? null,
        })),
        crashed: false,
      },
      null,
      2
    )
  );
}

void main();
