import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const snap = await getAdminDb().collection(COLLECTIONS.purchaseInvoices).doc("3WSwMr4DmwYc7lLfb5kJ").get();
  const inv = snap.data() as {
    invoiceDate?: unknown;
    headerConfidence?: unknown;
    vatRate?: unknown;
    lines?: { rawName?: string; quantity?: number; unitPrice?: number; vatType?: string; vatRate?: number; lineNet?: number; lineGross?: number; netAmount?: number; grossAmount?: number; vatAmount?: number }[];
  };
  console.log(JSON.stringify({
    invoiceDate: inv.invoiceDate,
    vatRate: inv.vatRate,
    headerConfidence: inv.headerConfidence,
    lines: inv.lines?.map((line) => ({
      name: line.rawName,
      qty: line.quantity,
      price: line.unitPrice,
      vatType: line.vatType,
      vatRate: line.vatRate,
      lineNet: line.lineNet,
      net: line.netAmount,
      gross: line.grossAmount,
      vat: line.vatAmount,
    })),
  }, null, 2));
}

void main();
