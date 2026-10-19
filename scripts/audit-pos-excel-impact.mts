import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { priorExcelFinanceWrites, priorExcelStockWrites } from "../src/lib/inventory/pos-excel";
import type { InventoryMovement, PosImport } from "../src/lib/inventory/types";

async function main() {
  const db = getAdminDb();
  const [importsSnap, movementsSnap, zSnap, financeSnap] = await Promise.all([
    db.collection(COLLECTIONS.posImports).limit(400).get(),
    db.collection(COLLECTIONS.inventoryMovements).limit(800).get(),
    db.collection(COLLECTIONS.posZReports).limit(200).get().catch(() => ({ docs: [] as { id: string; data: () => Record<string, unknown> }[] })),
    db.collection(COLLECTIONS.posFinanceEntries).limit(200).get().catch(() => ({ docs: [] as { id: string; data: () => Record<string, unknown> }[] })),
  ]);
  const imports = importsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as PosImport[];
  const movements = movementsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as InventoryMovement[];
  const stock = priorExcelStockWrites(movements);
  const finance = priorExcelFinanceWrites(imports);
  const report = {
    posImports: imports.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      period: item.period,
      kind: item.kind ?? null,
      infoOnly: item.infoOnly ?? null,
      financeStatus: item.financeStatus ?? null,
      status: item.status,
      lineCount: item.lines?.length ?? 0,
      reportedRevenueSum: item.reportedRevenueSum ?? null,
    })),
    priorStockMovements: stock.map((row) => ({
      id: row.id,
      type: row.type,
      productId: row.productId,
      posImportId: row.posImportId,
      quantityBase: row.quantityBase,
      note: row.note ?? null,
    })),
    priorFinanceMarkedImports: finance.map((item) => item.id),
    zReports: zSnap.docs.length,
    financeEntries: financeSnap.docs.length,
    autoDeleted: false,
  };
  console.log(JSON.stringify(report, null, 2));
}

void main();
