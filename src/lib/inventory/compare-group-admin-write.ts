import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { PURCHASE_UNITS } from "@/lib/costing/units";
import type { PurchaseUnit } from "@/lib/costing/types";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { resolveCompareGroupId } from "@/lib/inventory/material-group";
import { unitCostFromPackage } from "@/lib/inventory/stock";
import { splitVat } from "@/lib/inventory/vat";
import type { VatType } from "@/lib/inventory/types";

const MAX_MEMBERS = 40;

export async function persistCompareGroup(
  db: Firestore,
  input: { groupId?: string; name: string; memberIds: string[] }
): Promise<{ id: string; name: string; memberIds: string[] }> {
  const name = input.name.trim();
  const memberIds = [...new Set(input.memberIds.map((id) => id.trim()).filter(Boolean))];
  if (!name || memberIds.length === 0 || memberIds.length > MAX_MEMBERS) throw new Error("VALIDATION");

  const memberRefs = memberIds.map((id) => db.collection(COLLECTIONS.ingredients).doc(id));
  const memberSnaps = await Promise.all(memberRefs.map((ref) => ref.get()));
  if (memberSnaps.some((snap) => !snap.exists)) throw new Error("VALIDATION");

  const id = resolveCompareGroupId({
    groupId: input.groupId,
    name,
    members: memberSnaps.map((snap) => ({
      id: snap.id,
      compareGroupId: snap.get("compareGroupId") as string | undefined,
      compareGroupName: snap.get("compareGroupName") as string | undefined,
    })),
  });
  const now = new Date().toISOString();
  const batch = db.batch();

  const current = await db.collection(COLLECTIONS.ingredients).where("compareGroupId", "==", id).get();
  for (const item of current.docs) {
    if (memberIds.includes(item.id)) continue;
    batch.update(item.ref, {
      compareGroupId: FieldValue.delete(),
      compareGroupName: FieldValue.delete(),
      updatedAt: now,
    });
  }
  for (const snap of memberSnaps) {
    batch.update(snap.ref, {
      compareGroupId: id,
      compareGroupName: name,
      updatedAt: now,
    });
  }

  const oldMaps = await db.collection(COLLECTIONS.supplierItemMaps).where("compareGroupId", "==", id).get();
  for (const item of oldMaps.docs) {
    const productId = String(item.get("inventoryProductId") ?? "");
    if (memberIds.includes(productId)) continue;
    batch.update(item.ref, {
      compareGroupId: FieldValue.delete(),
      compareGroupName: FieldValue.delete(),
      updatedAt: now,
    });
  }
  for (const memberId of memberIds) {
    const maps = await db.collection(COLLECTIONS.supplierItemMaps).where("inventoryProductId", "==", memberId).get();
    for (const item of maps.docs) {
      batch.update(item.ref, {
        compareGroupId: id,
        compareGroupName: name,
        updatedAt: now,
      });
    }
  }

  await batch.commit();

  const after = await Promise.all(memberRefs.map((ref) => ref.get()));
  const confirmed = after
    .filter((snap) => snap.get("compareGroupId") === id && snap.get("compareGroupName") === name)
    .map((snap) => snap.id);
  if (confirmed.length !== memberIds.length) throw new Error("SAVE_INCOMPLETE");
  return { id, name, memberIds: confirmed };
}

export async function persistComparePack(
  db: Firestore,
  input: { productId: string; supplierId: string; packageQuantity: number; purchaseUnit: PurchaseUnit }
): Promise<void> {
  const productId = input.productId.trim();
  const supplierId = input.supplierId.trim();
  const qty = input.packageQuantity;
  const unit = input.purchaseUnit;
  if (!productId || !supplierId || !(qty > 0) || !PURCHASE_UNITS.includes(unit)) throw new Error("VALIDATION");
  const now = new Date().toISOString();
  const offers = await db.collection(COLLECTIONS.supplierOffers).where("productId", "==", productId).get();
  const offer = offers.docs.find((item) => String(item.get("supplierId") ?? "") === supplierId);
  if (offer) {
    await offer.ref.update({
      packageQuantity: qty,
      purchaseUnit: unit,
      lastPackageQuantity: qty,
      lastUnit: unit,
      updatedAt: now,
    });
  }
  const maps = await db.collection(COLLECTIONS.supplierItemMaps).where("inventoryProductId", "==", productId).get();
  for (const item of maps.docs) {
    if (String(item.get("supplierId") ?? "") !== supplierId) continue;
    await item.ref.update({
      packageQuantity: qty,
      purchaseUnit: unit,
      updatedAt: now,
    });
  }
}

export async function persistComparePurchaseBasis(
  db: Firestore,
  input: {
    productId: string;
    supplierId: string;
    price: number;
    packageQuantity: number;
    purchaseUnit: PurchaseUnit;
    vatMode: "net" | "gross";
  }
): Promise<void> {
  const productId = input.productId.trim();
  const supplierId = input.supplierId.trim();
  const qty = input.packageQuantity;
  const unit = input.purchaseUnit;
  const price = input.price;
  if (!productId || !supplierId || !(price > 0) || !(qty > 0) || !PURCHASE_UNITS.includes(unit)) throw new Error("VALIDATION");
  if (input.vatMode !== "net" && input.vatMode !== "gross") throw new Error("VALIDATION");
  const product = await db.collection(COLLECTIONS.ingredients).doc(productId).get();
  const supplier = await db.collection(COLLECTIONS.suppliers).doc(supplierId).get();
  if (!product.exists || !supplier.exists) throw new Error("VALIDATION");

  const vatType: VatType = input.vatMode === "net" ? "exclusive" : "inclusive";
  const money = splitVat({ amount: price, vatType, vatRate: 0.18 });
  const normalized = unitCostFromPackage(input.vatMode === "net" ? money.priceBeforeVat : money.priceIncludingVat, qty, unit);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const offers = await db.collection(COLLECTIONS.supplierOffers).where("productId", "==", productId).get();
  const existing = offers.docs.find((item) => String(item.get("supplierId") ?? "") === supplierId);
  const payload = {
    productId,
    supplierId,
    vatType,
    vatRate: 0.18,
    priceBeforeVat: money.priceBeforeVat,
    vatAmount: money.vatAmount,
    priceIncludingVat: money.priceIncludingVat,
    packageQuantity: qty,
    purchaseUnit: unit,
    normalizedPrice: normalized,
    lastUnitCost: normalized,
    lastPriceIncludingVat: money.priceIncludingVat,
    lastPriceBeforeVat: money.priceBeforeVat,
    lastPackageQuantity: qty,
    lastUnit: unit,
    lastPurchaseDate: today,
    lastPurchasedAt: today,
    notes: "compare-basis",
    active: true,
    updatedAt: now,
  };
  if (existing) await existing.ref.set(payload, { merge: true });
  else await db.collection(COLLECTIONS.supplierOffers).add({ ...payload, createdAt: now });
}
