import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.ingredientPriceHistory).get();
  const rows = snap.docs.map((d) => d.data()).filter((d) => d.previousPrice === 60 && d.newPrice === 70);
  console.log("history_total", snap.size);
  console.log("history_60_to_70", rows.length);
}

main();
