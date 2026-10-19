import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { invoiceSummary } from "../src/lib/inventory/invoice-lines";
import { toDateOnly } from "../src/lib/dates/normalize";
import type { PurchaseInvoice } from "../src/lib/inventory/types";

async function main() {
  const snap = await getAdminDb().collection(COLLECTIONS.purchaseInvoices).limit(400).get();
  const hits = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as PurchaseInvoice)
    .filter((item) => String(item.invoiceNumber || "").includes("10275") || String(item.supplierName || "").toLowerCase().includes("brioche") || String(item.supplierName || "").includes("בריאוש"));
  for (const invoice of hits) {
    const summary = invoiceSummary(invoice.lines || [], invoice.vatRate || 0.18);
    console.log(
      JSON.stringify({
        id: invoice.id,
        number: invoice.invoiceNumber,
        date: toDateOnly(invoice.invoiceDate) || invoice.invoiceDate || null,
        due: toDateOnly(invoice.dueDate) || invoice.dueDate || null,
        supplier: invoice.supplierName,
        supplierId: invoice.supplierId || null,
        status: invoice.status,
        stock: invoice.stockStatus,
        lines: invoice.lines?.length ?? 0,
        source: { net: invoice.sourceNet ?? invoice.netAmount, vat: invoice.sourceVat ?? invoice.vatAmount, gross: invoice.sourceGross ?? invoice.grossAmount },
        computed: { net: summary.beforeVat, vat: summary.vat, gross: summary.includingVat, items: summary.itemCount },
        firstLine: invoice.lines?.[0] ? { name: invoice.lines[0].rawName, qty: invoice.lines[0].quantity, unit: invoice.lines[0].unit, price: invoice.lines[0].unitPrice, net: invoice.lines[0].netAmount, gross: invoice.lines[0].grossAmount } : null,
      })
    );
  }
  if (!hits.length) console.log(JSON.stringify({ found: 0, total: snap.size }));
}

void main();
