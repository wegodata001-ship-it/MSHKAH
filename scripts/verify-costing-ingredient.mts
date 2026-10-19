import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getAdminAuth, getAdminDb } from "../src/lib/firebase/admin";
import { getFirebaseConfig } from "../src/lib/firebase/env";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { costPerBaseUnit } from "../src/lib/costing/units";

async function main() {
  const adminDb = getAdminDb();
  const admins = await adminDb.collection(COLLECTIONS.users).where("role", "==", "Admin").limit(1).get();
  if (admins.empty) throw new Error("No Admin user document found");
  const adminUid = admins.docs[0]!.id;
  const adminRole = admins.docs[0]!.data().role;
  const adminActive = admins.docs[0]!.data().active;
  console.log("admin_uid_present", Boolean(adminUid));
  console.log("admin_role", adminRole);
  console.log("admin_active", adminActive);
  console.log("collection", COLLECTIONS.ingredients);

  const token = await getAdminAuth().createCustomToken(adminUid);
  const app = initializeApp(getFirebaseConfig(), "costing-verify");
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  const auth = getAuth(app);
  await signInWithCustomToken(auth, token);
  console.log("signed_in_uid_matches", auth.currentUser?.uid === adminUid);

  const createPayload = {
    name: "TEST שניצל",
    purchasePrice: 60,
    purchaseQuantity: 2,
    purchaseUnit: "kg",
    baseUnit: "g",
    costPerBaseUnit: costPerBaseUnit(60, 2, "kg"),
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const created = await addDoc(collection(db, COLLECTIONS.ingredients), createPayload);
  const afterCreate = await getDoc(doc(db, COLLECTIONS.ingredients, created.id));
  console.log("CREATE INGREDIENT", afterCreate.exists() ? "PASS" : "FAIL");
  console.log("READ INGREDIENT", afterCreate.exists() ? "PASS" : "FAIL");
  console.log("unit_cost", afterCreate.data()?.costPerBaseUnit);

  await updateDoc(doc(db, COLLECTIONS.ingredients, created.id), {
    purchasePrice: 70,
    costPerBaseUnit: costPerBaseUnit(70, 2, "kg"),
    updatedAt: new Date(),
  });
  const afterUpdate = await getDoc(doc(db, COLLECTIONS.ingredients, created.id));
  console.log("UPDATE INGREDIENT", afterUpdate.data()?.purchasePrice === 70 ? "PASS" : "FAIL");

  const historyRef = await addDoc(collection(db, COLLECTIONS.ingredientPriceHistory), {
    ingredientId: created.id,
    previousPrice: 60,
    newPrice: 70,
    previousQuantity: 2,
    newQuantity: 2,
    changedAt: new Date(),
  });
  const historySnap = await getDoc(doc(db, COLLECTIONS.ingredientPriceHistory, historyRef.id));
  console.log("PRICE HISTORY WRITE", historySnap.exists() ? "PASS" : "FAIL");

  const recipeRead = await getDocs(collection(db, COLLECTIONS.dishRecipes));
  console.log("RECIPE READ", "PASS");
  console.log("recipe_count", recipeRead.size);

  const recipeRef = await addDoc(collection(db, COLLECTIONS.dishRecipes), {
    productId: "__costing_verify__",
    ingredients: [{ ingredientId: created.id, quantity: 180, unit: "g" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const recipeSnap = await getDoc(doc(db, COLLECTIONS.dishRecipes, recipeRef.id));
  const recipeHasNoPrice = !("purchasePrice" in ((recipeSnap.data()?.ingredients as object[])?.[0] ?? {}));
  console.log("RECIPE WRITE", recipeSnap.exists() && recipeHasNoPrice ? "PASS" : "FAIL");

  const settingsRef = doc(db, COLLECTIONS.costingSettings, "default");
  const settingsSnap = await getDoc(settingsRef);
  await setDoc(
    settingsRef,
    {
      targetFoodCostPercent: settingsSnap.exists()
        ? settingsSnap.data()?.targetFoodCostPercent ?? 30
        : 30,
      updatedAt: new Date(),
    },
    { merge: true }
  );
  const settingsAfter = await getDoc(settingsRef);
  console.log("COSTING SETTINGS WRITE", settingsAfter.exists() ? "PASS" : "FAIL");

  await adminDb.collection(COLLECTIONS.dishRecipes).doc(recipeRef.id).delete();

  await signOut(auth);
  let denied = false;
  try {
    await addDoc(collection(db, COLLECTIONS.ingredients), { name: "should-fail" });
  } catch (error) {
    denied = /permission/i.test(error instanceof Error ? error.message : "");
  }
  console.log("UNAUTHORIZED ACCESS BLOCKED", denied ? "PASS" : "FAIL");

  await adminDb.collection(COLLECTIONS.ingredients).doc(created.id).update({ active: false });
  const leftover = await adminDb
    .collection(COLLECTIONS.ingredients)
    .where("name", "==", "TEST שניצל")
    .get();
  console.log("test_docs", leftover.size);
}

main().catch((error) => {
  console.error("VERIFY_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
