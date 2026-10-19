/**
 * Deploy the local firestore.rules file to the live Firebase project
 * using the Firebase Admin SDK and a service account from .env.
 *
 * Keeps the local file as the source of truth. Prints the deployed ruleset
 * id and shows the current project.
 */

import { config } from "dotenv";
config({ path: ".env" });

import { readFile } from "node:fs/promises";
import { getSecurityRules } from "firebase-admin/security-rules";
import { getAdminApp } from "../src/lib/firebase/admin";

async function main() {
  const source = await readFile("firestore.rules", "utf8");
  const app = getAdminApp();
  const rules = getSecurityRules(app);
  console.log(`Project: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
  console.log(`Source length: ${source.length} bytes`);
  const released = await rules.releaseFirestoreRulesetFromSource(source);
  console.log(`Deployed Firestore rules. Ruleset id: ${released.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
