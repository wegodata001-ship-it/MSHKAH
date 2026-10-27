/**
 * Read-only report of invoice lines versus stock movements.
 * Does not write invoices, stock, or movements.
 */
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

async function main() {
  const { getAdminDb } = await import("../src/lib/firebase/admin");
  const { COLLECTIONS } = await import("../src/lib/firebase/collections");
  const { loadMeasureUnitCatalog } = await import("../src/lib/inventory/measure-units-admin");
  const { setMeasureUnitCatalog } = await import("../src/lib/inventory/measure-units");
  const { auditInvoiceMovements } = await import("../src/lib/inventory/invoice-stock-audit");
  const db = getAdminDb();
  setMeasureUnitCatalog(await loadMeasureUnitCatalog(db));
  const [invoices, movements, archivedMovements] = await Promise.all([
    db.collection(COLLECTIONS.purchaseInvoices).get(),
    db.collection(COLLECTIONS.inventoryMovements).get(),
    db.collection(COLLECTIONS.archiveInventoryMovements).get(),
  ]);
  const movementRows = [...movements.docs, ...archivedMovements.docs].map((doc) => {
    const data = doc.data() as { quantityBase?: number | null };
    return { id: doc.id, quantityBase: data.quantityBase ?? null };
  });
  const archive = await db.collection(COLLECTIONS.archivePurchaseInvoices).get();
  const counts = { ok: 0, "missing-movement": 0, "quantity-gap": 0, "duplicate-movement": 0, unusual: 0 };
  const samples: string[] = [];
  const stray: string[] = [];
  let posted = 0;
  const docs = [...invoices.docs, ...archive.docs];
  for (const doc of docs) {
    const invoice = doc.data() as { stockStatus?: string; inventoryPostedAt?: string; invoiceNumber?: string; lines?: never[] };
    if (invoice.stockStatus !== "posted" && !invoice.inventoryPostedAt) continue;
    posted += 1;
    const findings = auditInvoiceMovements({
      invoiceId: doc.id,
      lines: (invoice.lines ?? []) as never,
      movements: movementRows,
    });
    for (const finding of findings) {
      counts[finding.kind] += 1;
      if (finding.kind !== "ok" && samples.length < 20) {
        samples.push(`${invoice.invoiceNumber || doc.id} ${finding.lineKey} ${finding.unit ?? "?"} ${finding.purchaseQuantity} → expected ${finding.expectedStock} recorded ${finding.recordedStock} [${finding.kind}]`);
      }
    }
    for (const line of (invoice.lines ?? []) as Array<{ key?: string; unit?: string; quantity?: number; conversionFactor?: number | null }>) {
      if ((line.unit === "unit" || line.unit === "bucket") && line.conversionFactor != null && line.conversionFactor > 1 && stray.length < 20) {
        stray.push(`${invoice.invoiceNumber || doc.id} ${line.key} ${line.unit} qty ${line.quantity} factor ${line.conversionFactor}`);
      }
    }
  }
  console.log(JSON.stringify({ invoices: invoices.size, archived: archive.size, posted, movements: movements.size, archivedMovements: archivedMovements.size, counts, samples, strayUnitFactors: stray }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
