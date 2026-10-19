import { config } from "dotenv";
config({ path: ".env" });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

function isTestName(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase() === "TEST";
}

function isTestProduct(data: Record<string, unknown>): boolean {
  return (
    data.isTestProduct === true ||
    isTestName(data.name) ||
    isTestName(data.nameEn) ||
    isTestName(data.nameHe) ||
    isTestName(data.nameAr) ||
    isTestName(data.name_en) ||
    isTestName(data.name_he) ||
    isTestName(data.name_ar)
  );
}

async function main() {
  const db = getAdminDb();
  const productsSnap = await db.collection(COLLECTIONS.products).get();
  const matches = productsSnap.docs.filter((doc) =>
    isTestProduct(doc.data() as Record<string, unknown>)
  );

  if (matches.length === 0) {
    console.log("TEST product: none found in products collection.");
  }

  const matchIds = new Set(matches.map((doc) => doc.id));
  const referencedIds = new Set<string>();
  let namedTestOrder = false;

  const ordersSnap = await db.collection(COLLECTIONS.orders).get();
  for (const order of ordersSnap.docs) {
    const items = order.data().items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const productId = String(item?.productId ?? "");
      const productName = String(item?.productName ?? "");
      if (productId && matchIds.has(productId)) referencedIds.add(productId);
      if (isTestName(productName)) namedTestOrder = true;
    }
  }

  for (const doc of matches) {
    const referenced = referencedIds.has(doc.id) || namedTestOrder;
    if (referenced) {
      await doc.ref.update({
        active: false,
        hidden: true,
        isTestProduct: true,
        available: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`TEST product hidden (history kept): ${doc.id}`);
    } else {
      await doc.ref.delete();
      console.log(`TEST product deleted (no order references): ${doc.id}`);
    }
  }

  const categoriesSnap = await db.collection(COLLECTIONS.categories).get();
  const testCategories = categoriesSnap.docs.filter((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return (
      isTestName(doc.id) ||
      isTestName(data.name) ||
      isTestName(data.nameEn) ||
      isTestName(data.nameHe) ||
      isTestName(data.nameAr)
    );
  });

  for (const doc of testCategories) {
    const productRefs = productsSnap.docs.filter((product) => product.data().categoryId === doc.id);
    const referenced = productRefs.length > 0 || namedTestOrder;
    if (referenced) {
      await doc.ref.update({
        active: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`TEST category hidden (references kept): ${doc.id} products=${productRefs.length}`);
    } else {
      await doc.ref.delete();
      console.log(`TEST category deleted (no references): ${doc.id}`);
    }
  }
}

main().catch((error) => {
  console.error("TEST product hide failed:", error instanceof Error ? error.message : "unknown");
  process.exit(1);
});
