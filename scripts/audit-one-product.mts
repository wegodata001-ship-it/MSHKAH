import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.products).limit(3).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    console.log({
      id: doc.id,
      keys: Object.keys(data).sort(),
      name: data.name ?? null,
      name_he: data.name_he ?? null,
      name_ar: data.name_ar ?? null,
      name_en: data.name_en ?? null,
      title: data.title ?? null,
    });
  }
}

void main();
