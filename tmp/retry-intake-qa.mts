import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { postInvoiceStock } from "../src/lib/inventory/invoice-admin-write";
import type { PurchaseInvoice } from "../src/lib/inventory/types";

const INVOICE_ID = "qa-intake-1910";

async function snapshot(label: string) {
  const db = getAdminDb();
  const moves = await db.collection(COLLECTIONS.inventoryMovements).where("invoiceId", "==", INVOICE_ID).get();
  const productIds = [...new Set(moves.docs.map((doc) => String(doc.data().productId || "")))].filter(Boolean);
  const balances = await Promise.all(productIds.map(async (id) => {
    const bal = await db.collection(COLLECTIONS.inventoryBalances).doc(id).get();
    return `${id}:${bal.data()?.quantityBase ?? "missing"} ${moves.docs.filter((doc) => doc.data().productId === id).map((doc) => doc.data().quantityBase).join("+")}`;
  }));
  process.stdout.write(`${label} movements=${moves.size} ${balances.join(" | ")}\n`);
}

async function main() {
  const db = getAdminDb();
  await snapshot("before");
  const snap = await db.collection(COLLECTIONS.purchaseInvoices).doc(INVOICE_ID).get();
  const invoice = { id: snap.id, ...snap.data() } as PurchaseInvoice;
  const first = await postInvoiceStock(db, invoice, undefined, "qa-retry");
  await snapshot(`after-1 reused=${first.reusedKeys.join("|")} posted=${first.postedKeys.join("|")}`);
  const second = await postInvoiceStock(db, first.invoice, undefined, "qa-retry");
  await snapshot(`after-2 reused=${second.reusedKeys.join("|")} posted=${second.postedKeys.join("|")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
