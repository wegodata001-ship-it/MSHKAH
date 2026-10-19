import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const snap = await getAdminDb().collection(COLLECTIONS.purchaseInvoices).doc("RoA1BEbQlbl6VvkvdfYU").get();
  const inv = snap.data() as {
    invoiceNumber?: string;
    invoiceDate?: string;
    supplierName?: string;
    netAmount?: number;
    vatAmount?: number;
    grandTotal?: number;
    stockStatus?: string;
    status?: string;
    scanStatus?: string;
    sourceFile?: { storagePath?: string };
    lines?: { rawName?: string; quantity?: number; unitPrice?: number; lineTotal?: number }[];
  };
  console.log(
    JSON.stringify({
      exists: snap.exists,
      number: inv?.invoiceNumber,
      date: inv?.invoiceDate,
      supplier: inv?.supplierName,
      net: inv?.netAmount,
      vat: inv?.vatAmount,
      total: inv?.grandTotal,
      stockStatus: inv?.stockStatus,
      status: inv?.status,
      scanStatus: inv?.scanStatus,
      source: Boolean(inv?.sourceFile?.storagePath),
      lines: inv?.lines?.map((line) => ({ name: line.rawName, qty: line.quantity, price: line.unitPrice, total: line.lineTotal })),
    })
  );
}

void main();
