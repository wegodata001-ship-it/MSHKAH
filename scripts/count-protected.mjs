import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
if (privateKey.startsWith("\"")) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, "\n");
initializeApp({
  credential: cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey,
  }),
});
const db = getFirestore();
for (const name of ["orders", "payments", "customers", "categories", "users"]) {
  const snap = await db.collection(name).count().get();
  console.log(`${name}: ${snap.data().count}`);
}
