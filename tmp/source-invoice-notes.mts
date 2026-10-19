import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.purchaseInvoices).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const kinds = lines.reduce((acc: Record<string, number>, line: { matchKind?: string; skipInventory?: boolean; productId?: string }) => {
      const key = `${line.matchKind ?? "none"}${line.skipInventory ? ":skip" : ""}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const audit = Array.isArray(data.audit) ? data.audit.map((event: { action?: string }) => event.action).join(",") : "";
    console.log(
      JSON.stringify({
        id: doc.id,
        number: data.invoiceNumber,
        notes: data.notes ?? null,
        stock: data.stockStatus ?? null,
        status: data.status ?? null,
        file: data.fileName ?? data.sourceFile?.originalFilename ?? null,
        lines: lines.length,
        kinds,
        audit,
      })
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
