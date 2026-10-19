import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

function near(value: unknown, target: number) {
  return typeof value === "number" && Math.abs(value - target) < 0.02;
}

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.purchasePriceRecords).get();
  const hits = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>)
    .filter((row) =>
      ["priceBeforeVat", "priceIncludingVat", "lineTotalNet", "lineTotalGross", "vatAmount", "unitCost", "unitPriceNet", "unitPriceGross"].some(
        (key) => near(row[key], 244.8) || near(row[key], 288.86) || near(row[key], 44.06)
      )
    );
  for (const row of hits) {
    const product = row.productId ? await db.collection(COLLECTIONS.ingredients).doc(String(row.productId)).get() : null;
    const supplier = row.supplierId ? await db.collection(COLLECTIONS.suppliers).doc(String(row.supplierId)).get() : null;
    const net = row.priceBeforeVat;
    const vat = row.vatAmount;
    const gross = row.priceIncludingVat;
    const sum =
      typeof net === "number" && typeof vat === "number" && typeof gross === "number" ? Math.round((net + vat) * 100) / 100 : null;
    console.log(
      JSON.stringify({
        id: row.id,
        product: product?.get("name") ?? row.productId,
        supplier: supplier?.get("name") ?? row.supplierId,
        date: row.purchaseDate,
        qty: row.packageQuantity ?? row.quantity,
        unit: row.unit,
        priceBeforeVat: row.priceBeforeVat,
        vatAmount: row.vatAmount,
        priceIncludingVat: row.priceIncludingVat,
        lineTotalNet: row.lineTotalNet,
        lineTotalGross: row.lineTotalGross,
        unitPriceNet: row.unitPriceNet,
        unitCost: row.unitCost,
        vatType: row.vatType,
        storedSum: sum,
        sumMatchesGross: sum != null && typeof gross === "number" && Math.abs(sum - gross) <= 0.02,
        invoiceId: row.invoiceId,
      })
    );
  }
  console.log(`records=${snap.size} hits=${hits.length}`);
  for (const doc of snap.docs) {
    const row = doc.data();
    const product = await db.collection(COLLECTIONS.ingredients).doc(String(row.productId)).get();
    const supplier = row.supplierId ? await db.collection(COLLECTIONS.suppliers).doc(String(row.supplierId)).get() : null;
    console.log(
      [product.get("name"), supplier?.get("name") ?? "-", row.purchaseDate, row.packageQuantity ?? row.quantity, row.unit, row.priceBeforeVat, row.priceIncludingVat, row.vatType].join(" | ")
    );
  }
  const grouped = await db.collection(COLLECTIONS.ingredients).where("compareGroupId", "!=", null).get();
  const byGroup = new Map<string, string[]>();
  for (const doc of grouped.docs) {
    const id = String(doc.get("compareGroupId") || "");
    const name = String(doc.get("compareGroupName") || id);
    const list = byGroup.get(`${name}::${id}`) ?? [];
    list.push(String(doc.get("name")));
    byGroup.set(`${name}::${id}`, list);
  }
  for (const [key, names] of byGroup) console.log(`${key} => ${names.join(" | ")}`);
  const ingredients = await db.collection(COLLECTIONS.ingredients).where("name", "==", "מאפה פתוח").get();
  for (const doc of ingredients.docs) {
    const data = doc.data();
    console.log(JSON.stringify({ ingredientId: doc.id, groupId: data.compareGroupId, groupName: data.compareGroupName, baseUnit: data.baseUnit }));
    if (data.compareGroupId) {
      const members = await db.collection(COLLECTIONS.ingredients).where("compareGroupId", "==", data.compareGroupId).get();
      console.log(members.docs.map((item) => `${item.get("name")}|${item.id}`).join(" ; "));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
