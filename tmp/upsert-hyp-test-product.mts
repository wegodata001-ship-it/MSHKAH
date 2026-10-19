import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const CATEGORY_ID = "test";
const PRODUCT_ID = "hyp-payment-test";

async function main() {
  const db = getAdminDb();
  const now = FieldValue.serverTimestamp();

  const existingProducts = await db.collection(COLLECTIONS.products).get();
  for (const doc of existingProducts.docs) {
    if (doc.id === PRODUCT_ID) continue;
    const data = doc.data();
    const names = [data.nameHe, data.nameAr, data.nameEn, data.name_he, data.name_ar].join(" ");
    if (
      names.includes("מוצר בדיקת תשלום") ||
      names.includes("منتج اختبار الدفع") ||
      names.includes("Payment Test Product")
    ) {
      throw new Error(`Refusing to create a second test product; found ${doc.id}`);
    }
  }

  await db.collection(COLLECTIONS.categories).doc(CATEGORY_ID).set(
    {
      nameHe: "TEST",
      nameAr: "TEST",
      nameEn: "TEST",
      icon: "utensils",
      color: "#0D9488",
      sortOrder: 9999,
      active: true,
      parentId: null,
      updatedAt: now,
    },
    { merge: true }
  );

  const productRef = db.collection(COLLECTIONS.products).doc(PRODUCT_ID);
  const existing = await productRef.get();
  if (existing.exists && existing.data()?.isTestProduct !== true) {
    throw new Error("hyp-payment-test exists and is not marked isTestProduct");
  }

  await productRef.set(
    {
      nameHe: "מוצר בדיקת תשלום",
      nameAr: "منتج اختبار الدفع",
      nameEn: "Payment Test Product",
      descriptionHe: "מוצר זמני לבדיקת סליקת HYP בלבד. לא למכירה רגילה.",
      descriptionAr: "منتج مؤقت لاختبار الدفع عبر HYP فقط. ليس للبيع العادي.",
      descriptionEn: "Temporary product for HYP payment testing only. Not for regular sale.",
      categoryId: CATEGORY_ID,
      subcategoryId: null,
      price: 2,
      cost: 0,
      profit: 2,
      businessType: "beverage",
      imageUrl: "",
      available: true,
      popular: false,
      newProduct: false,
      active: true,
      sortOrder: 1,
      isTestProduct: true,
      isWeighted: false,
      includesVat: true,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );

  const saved = await productRef.get();
  const product = saved.data() ?? {};
  const modifierLinks = await db
    .collection(COLLECTIONS.productModifierGroups)
    .where("productId", "==", PRODUCT_ID)
    .get();

  process.stdout.write(
    [
      `category=${CATEGORY_ID}`,
      `product=${PRODUCT_ID}`,
      `price=${product.price}`,
      `active=${product.active}`,
      `available=${product.available}`,
      `isTestProduct=${product.isTestProduct}`,
      `popular=${product.popular}`,
      `modifiers=${modifierLinks.size}`,
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
