import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

async function main() {
  const db = getAdminDb();
  let n = 0;
  for (const col of Object.values(COLLECTIONS)) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const blob = [doc.id, d.name, d.invoiceNumber, d.fileName, d.notes, d.sourceFile?.originalFilename].join(" ");
      if (blob.includes("TEST-QA")) {
        await doc.ref.delete();
        n += 1;
        console.log("del", col, doc.id);
      }
    }
  }
  console.log("deleted", n);
}

void main();
