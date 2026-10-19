import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { mapProduct } from "../src/lib/mappers";
import { computedUnitPrice, planPosApply } from "../src/lib/inventory/pos-apply";
import { excelMayAffectFinance } from "../src/lib/inventory/pos-excel";
import type { FirestoreDoc, FirestoreProduct } from "../src/types/firestore";
import type { PosSaleLine } from "../src/lib/inventory/types";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.products).limit(800).get();
  const products = snap.docs.map((doc) =>
    mapProduct({ id: doc.id, ...doc.data() } as FirestoreDoc<FirestoreProduct>)
  );
  const yogurt = products[0];
  const lines: PosSaleLine[] = [
    {
      key: "pos-30",
      sourceRow: 7,
      posCode: "",
      posName: yogurt?.name_he?.trim() || "יוגרט",
      quantity: 30,
      reportedRevenue: 1500,
      unitPrice: 49,
      matchKind: "none",
    },
    {
      key: "pos-new",
      sourceRow: 8,
      posCode: "",
      posName: "מוצר קופה חדש לבדיקה",
      quantity: 30,
      reportedRevenue: 1500,
      matchKind: "none",
    },
  ];
  const plan = planPosApply({
    lines,
    products,
    maps: [],
    recipes: [],
    movements: [],
    imports: [],
  });
  console.log(
    JSON.stringify(
      {
        computed30x1500: computedUnitPrice(1500, 30),
        yogurtRow: plan.rows[0] && {
          identity: plan.rows[0].identity,
          computed: plan.rows[0].computedUnitPrice,
          priceGap: plan.rows[0].priceGap,
          path: plan.rows[0].stockPath,
          after: plan.rows[0].impacts[0]?.balanceAfter,
        },
        newRow: plan.rows[1] && {
          identity: plan.rows[1].identity,
          createProduct: plan.rows[1].createProduct,
          after: plan.rows[1].impacts[0]?.balanceAfter,
          goesNegative: plan.rows[1].impacts[0]?.goesNegative,
        },
        financeFromExcel: excelMayAffectFinance(),
      },
      null,
      2
    )
  );
}

void main();
