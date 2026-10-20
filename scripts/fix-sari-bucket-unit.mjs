import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
if (privateKey.startsWith("\"")) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, "\n");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (projectId !== "mshkah") throw new Error(`WRONG_PROJECT_${projectId}`);
initializeApp({
  credential: cert({
    projectId,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey,
  }),
});
const db = getFirestore();
const moneyKeys = ["quantity", "unitPrice", "discount", "lineTotal", "lineNet", "lineGross", "vatRate", "vatAmount", "priceBeforeVat", "priceIncludingVat", "netAmount", "grossAmount"];

async function findInvoice() {
  for (const name of ["purchaseInvoices", "archivePurchaseInvoices"]) {
    const snap = await db.collection(name).get();
    const doc = snap.docs.find((item) => {
      const data = item.data();
      return String(data.invoiceNumber ?? "") === "127833" && String(data.supplierName ?? "").includes("SARI");
    });
    if (doc) return { name, doc };
  }
  return null;
}

const found = await findInvoice();
if (!found) throw new Error("INVOICE_NOT_FOUND");
const before = found.doc.data();
const lines = Array.isArray(before.lines) ? before.lines.map((line) => ({ ...line })) : [];
const line = lines[1];
if (!line || !String(line.rawName || "").includes("פטיסייר")) throw new Error("LINE2_NOT_FOUND");
if (Number(line.quantity) !== 1 || Number(line.unitPrice) !== 168) throw new Error("QTY_OR_PRICE_MISMATCH");
const headerBefore = {
  gross: before.grossAmount ?? before.grandTotal ?? null,
  net: before.netAmount ?? null,
  vat: before.vatAmount ?? null,
};
lines[1] = { ...line, unit: "bucket" };
for (const key of moneyKeys) {
  if (lines[1][key] !== line[key]) throw new Error(`LINE_MONEY_${key}`);
}
await found.doc.ref.update({ lines });
const saved = await found.doc.ref.get();
const savedLines = saved.data().lines;
const savedLine = savedLines[1];
const headerAfter = {
  gross: saved.data().grossAmount ?? saved.data().grandTotal ?? null,
  net: saved.data().netAmount ?? null,
  vat: saved.data().vatAmount ?? null,
};
if (savedLine.unit !== "bucket" || Number(savedLine.quantity) !== 1 || Number(savedLine.unitPrice) !== 168) {
  throw new Error("VERIFY_FAILED");
}
if (JSON.stringify(headerBefore) !== JSON.stringify(headerAfter)) throw new Error("HEADER_CHANGED");
if (savedLines.length !== lines.length) throw new Error("LINE_COUNT_CHANGED");
for (let index = 0; index < savedLines.length; index += 1) {
  if (index === 1) continue;
  if (savedLines[index].unit !== lines[index].unit) throw new Error(`OTHER_LINE_${index}`);
}

let movements = 0;
for (const name of ["inventoryMovements", "archiveInventoryMovements"]) {
  const snap = await db.collection(name).where("invoiceId", "==", found.doc.id).get();
  movements += snap.size;
  for (const movement of snap.docs) {
    const row = movement.data();
    if (row.invoiceLineKey !== line.key) continue;
    const quantity = row.quantity;
    const quantityBase = row.quantityBase;
    await movement.ref.update({ unit: "bucket" });
    const next = (await movement.ref.get()).data();
    if (next.quantity !== quantity || next.quantityBase !== quantityBase) {
      await movement.ref.update({ quantity, quantityBase });
      throw new Error("MOVEMENT_QTY_CHANGED");
    }
  }
}

console.log(JSON.stringify({
  projectId,
  collection: found.name,
  id: found.doc.id,
  line: 2,
  unit: savedLine.unit,
  quantity: savedLine.quantity,
  unitPrice: savedLine.unitPrice,
  lineTotal: savedLine.lineTotal,
  gross: savedLine.grossAmount,
  header: headerAfter,
  conversionFactor: savedLine.conversionFactor ?? null,
  movementsForInvoice: movements,
}, null, 2));
