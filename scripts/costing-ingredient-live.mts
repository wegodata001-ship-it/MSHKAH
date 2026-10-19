import { config } from "dotenv";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  initializeFirestore,
} from "firebase/firestore";

config({ path: ".env" });
config({ path: ".env.local", override: true });

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

async function main() {
  const email = env("ADMIN_BOOTSTRAP_EMAIL") || "admin@mishkat.cafe";
  const password = env("ADMIN_BOOTSTRAP_PASSWORD");
  const projectId = env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!password || !projectId) {
    console.log(JSON.stringify({ ok: false, step: "env", error: "missing admin or project env" }));
    process.exit(2);
  }

  const app = initializeApp({
    apiKey: env("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId,
    storageBucket: env("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: env("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: env("NEXT_PUBLIC_FIREBASE_APP_ID"),
  });
  const auth = getAuth(app);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });

  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const profileSnap = await getDoc(doc(db, "users", uid));
  const profile = profileSnap.exists() ? profileSnap.data() : null;

  const createPayload = {
    name: "TEST שניצל",
    category: null,
    purchasePrice: 60,
    purchaseQuantity: 2,
    purchaseUnit: "kg",
    baseUnit: "g",
    costPerBaseUnit: 0.03,
    supplier: null,
    notes: "live-permission-test",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const created = await addDoc(collection(db, "ingredients"), createPayload);
  const afterCreate = await getDoc(created);
  const createdData = afterCreate.data();

  await updateDoc(created, {
    purchasePrice: 70,
    costPerBaseUnit: 0.035,
    updatedAt: new Date(),
  });
  const history = await addDoc(collection(db, "ingredientPriceHistory"), {
    ingredientId: created.id,
    previousPrice: 60,
    newPrice: 70,
    previousQuantity: 2,
    newQuantity: 2,
    changedAt: new Date(),
    changedBy: email,
  });

  const refreshed = await getDoc(created);
  const historySnap = await getDoc(history);
  const listed = await getDocs(query(collection(db, "ingredients"), where("name", "==", "TEST שניצל")));

  await updateDoc(created, { active: false, updatedAt: new Date() });
  await signOut(auth);

  console.log(
    JSON.stringify({
      ok: Boolean(createdData && refreshed.data()?.purchasePrice === 70 && historySnap.exists()),
      projectId,
      uid,
      role: profile?.role ?? null,
      active: profile?.active ?? null,
      createdId: created.id,
      createReadBack: createdData?.purchasePrice === 60,
      updateReadBack: refreshed.data()?.purchasePrice === 70,
      historyWritten: historySnap.exists(),
      listAfterRefresh: listed.size,
      costAfterUpdate: refreshed.data()?.costPerBaseUnit,
    })
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown";
  console.log(JSON.stringify({ ok: false, step: "live", error: message }));
  process.exit(1);
});
