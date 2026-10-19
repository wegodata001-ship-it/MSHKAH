import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.ingredients).where("name", "==", "TEST שניצל").get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  console.log("deleted_test_ingredients", snap.size);
}

main();
