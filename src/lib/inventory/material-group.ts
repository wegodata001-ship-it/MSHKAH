import { aliasOverlap } from "@/lib/costing/ingredient-aliases";
import { normalizeIngredientName } from "@/lib/costing/names";
import type { BaseUnit, CostingIngredient, PurchaseUnit } from "@/lib/costing/types";
import { baseUnitFor } from "@/lib/costing/units";
import { MATCH_SAFE_MIN, MATCH_SUGGEST_MIN, productNameSimilarity, rankProductMatches } from "@/lib/inventory/product-match";
import { offerPurchaseUnit } from "@/lib/inventory/stock";
import { unitCostFromPackage } from "@/lib/inventory/stock";
import type {
  PurchaseInvoiceLine,
  PurchasePriceRecord,
  Supplier,
  SupplierItemMap,
  SupplierOffer,
  VatType,
} from "@/lib/inventory/types";

export type MaterialGroupKind = "same" | "compare";

export type IngredientCompareGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

export type CompareDisplayUnit = "kg" | "liter" | "unit";
export type CompareVatMode = "net" | "gross";
export type CompareRowReason = "missing-pack" | "missing-price" | "unit-mismatch" | "vat-mismatch" | null;

export type MaterialCompareRow = {
  ingredientId: string;
  ingredientName: string;
  supplierId: string;
  supplierName: string;
  supplierProductName: string;
  offerId?: string;
  packQuantity: number | null;
  packUnit: PurchaseUnit | undefined;
  buyPrice: number | null;
  unitCost: number | null;
  displayUnitCost: number | null;
  displayUnit: CompareDisplayUnit;
  vatBasis: "net" | "gross" | "unknown";
  currency: string;
  purchaseDate?: string;
  invoiceNumber?: string | null;
  source: "purchase";
  complete: boolean;
  comparable: boolean;
  cheapest: boolean;
  gapAmount: number | null;
  gapPercent: number | null;
  reason: CompareRowReason;
  savingsVsLine: number | null;
};

export type CompareProductPick = {
  key: string;
  ingredientId: string;
  ingredientName: string;
  supplierId: string;
  supplierName: string;
  supplierProductName: string;
  sku?: string;
};

export type MaterialGroupSuggestion = {
  show: boolean;
  autoFill?: { ingredientId: string; name: string };
  packConflict: boolean;
  candidates: { id: string; name: string; score: number }[];
  groups: IngredientCompareGroup[];
  compareRows: MaterialCompareRow[];
};

export function listCompareGroups(ingredients: CostingIngredient[]): IngredientCompareGroup[] {
  const byId = new Map<string, IngredientCompareGroup>();
  for (const item of ingredients) {
    const id = item.compareGroupId?.trim();
    if (!id) continue;
    const current = byId.get(id) ?? { id, name: item.compareGroupName?.trim() || item.name, memberIds: [] };
    current.memberIds.push(item.id);
    if (item.compareGroupName?.trim()) current.name = item.compareGroupName.trim();
    byId.set(id, current);
  }
  return [...byId.values()];
}

export function newCompareGroupId(name: string): string {
  const slug = normalizeIngredientName(name).replace(/\s+/g, "-").slice(0, 32) || "group";
  return `grp-${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A selling phrase such as "3 ב־10 ש״ח" is not a purchase price and not pack contents. */
export function purchaseFactsFromProductName(_name: string): { price: null; packQuantity: null } {
  return { price: null, packQuantity: null };
}

export function resolveCompareGroupId(input: {
  groupId?: string;
  name: string;
  members: { id: string; compareGroupId?: string | null; compareGroupName?: string | null }[];
}): string {
  const requested = input.groupId?.trim();
  if (requested) return requested;
  const nameKey = normalizeIngredientName(input.name);
  const ids = [...new Set(input.members.map((item) => item.compareGroupId?.trim()).filter((id): id is string => Boolean(id)))];
  if (
    ids.length === 1 &&
    input.members.length > 0 &&
    input.members.every(
      (item) => item.compareGroupId?.trim() === ids[0] && normalizeIngredientName(item.compareGroupName ?? "") === nameKey
    )
  ) {
    return ids[0]!;
  }
  return newCompareGroupId(input.name);
}

export function compareCoverage(rows: MaterialCompareRow[]): { suppliers: number; products: number } {
  const products = new Set(rows.map((row) => row.ingredientId));
  const suppliers = new Set(rows.map((row) => (row.supplierId || row.supplierName).trim()).filter(Boolean));
  return { suppliers: suppliers.size, products: products.size };
}

export function cheapestComparableCohort(rows: MaterialCompareRow[]): MaterialCompareRow[] {
  const ready = rows.filter((row) => row.comparable && row.displayUnitCost != null && row.vatBasis !== "unknown");
  const groups = new Map<string, MaterialCompareRow[]>();
  for (const row of ready) {
    const key = `${row.displayUnit}|${row.vatBasis}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const cohorts = [...groups.values()].filter((items) => items.length >= 2);
  if (cohorts.length !== 1) return [];
  return cohorts[0] ?? [];
}

export function rememberedMap(
  maps: SupplierItemMap[],
  supplierId: string | undefined,
  line: { name: string; sku?: string | null }
): SupplierItemMap | undefined {
  return maps.find((item) => {
    if (supplierId && item.supplierId !== supplierId) return false;
    if (line.sku && item.supplierSku && item.supplierSku === line.sku) return true;
    return normalizeIngredientName(item.supplierProductName) === normalizeIngredientName(line.name);
  });
}

export function packFieldsConflict(
  existing: Pick<SupplierItemMap, "purchaseUnit" | "packageQuantity" | "conversion">,
  incoming: { unit?: PurchaseUnit | null; packageQuantity?: number | null; conversion?: number | null }
): boolean {
  if (existing.purchaseUnit && incoming.unit && existing.purchaseUnit !== incoming.unit) return true;
  if (existing.conversion != null && incoming.conversion != null && Math.abs(existing.conversion - incoming.conversion) > 0.0001) {
    return true;
  }
  if (
    existing.packageQuantity != null &&
    incoming.packageQuantity != null &&
    existing.conversion == null &&
    incoming.conversion == null &&
    Math.abs(existing.packageQuantity - incoming.packageQuantity) > 0.0001
  ) {
    return true;
  }
  return false;
}

export function reconcileSupplierItemMap(
  existing: SupplierItemMap | undefined,
  incoming: {
    supplierId: string;
    supplierProductName: string;
    supplierSku?: string;
    inventoryProductId: string;
    purchaseUnit?: PurchaseUnit;
    packageQuantity?: number;
    conversion?: number;
  }
): { next: typeof incoming; packConflict: boolean; keepLink: true } {
  if (!existing || existing.inventoryProductId !== incoming.inventoryProductId) {
    return { next: incoming, packConflict: false, keepLink: true };
  }
  const packConflict = packFieldsConflict(existing, incoming);
  if (!packConflict) return { next: incoming, packConflict: false, keepLink: true };
  return {
    next: {
      ...incoming,
      purchaseUnit: existing.purchaseUnit ?? incoming.purchaseUnit,
      packageQuantity: existing.packageQuantity ?? incoming.packageQuantity,
      conversion: existing.conversion ?? incoming.conversion,
    },
    packConflict: true,
    keepLink: true,
  };
}

function extraNames(item: CostingIngredient, maps: SupplierItemMap[]): string[] {
  return maps.filter((map) => map.inventoryProductId === item.id).map((map) => map.supplierProductName);
}

export function similarMaterialCandidates(
  line: { name: string; sku?: string | null; barcode?: string | null },
  ingredients: CostingIngredient[],
  maps: SupplierItemMap[] = []
): { id: string; name: string; score: number }[] {
  const ranked = rankProductMatches(line.name, ingredients);
  const extras = ingredients
    .filter((item) => item.active !== false)
    .map((item) => {
      const aliasScore = Math.max(
        0,
        ...extraNames(item, maps).map((name) => Math.max(productNameSimilarity(line.name, name), aliasOverlap(line.name, name))),
        aliasOverlap(line.name, item.name),
        productNameSimilarity(line.name, item.name)
      );
      const skuHit = line.sku && item.barcode && line.sku === item.barcode ? 1 : 0;
      const barcodeHit = line.barcode && item.barcode && line.barcode === item.barcode ? 1 : 0;
      return { id: item.id, name: item.name, score: Math.max(aliasScore, skuHit, barcodeHit) };
    })
    .filter((item) => item.score >= MATCH_SUGGEST_MIN);
  const byId = new Map<string, { id: string; name: string; score: number }>();
  for (const row of [...ranked.map((item) => ({ id: item.productId, name: item.name, score: item.score })), ...extras]) {
    const prev = byId.get(row.id);
    if (!prev || row.score > prev.score) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

export function displayUnitForBase(base: BaseUnit): CompareDisplayUnit {
  if (base === "g") return "kg";
  if (base === "ml") return "liter";
  return "unit";
}

export function toDisplayUnitCost(unitCostPerBase: number | null, base: BaseUnit): number | null {
  if (unitCostPerBase == null || !Number.isFinite(unitCostPerBase)) return null;
  return base === "g" || base === "ml" ? unitCostPerBase * 1000 : unitCostPerBase;
}

export function shouldUpdateLastPurchase(existingDate: string | null | undefined, incomingDate: string | null | undefined): boolean {
  const current = (existingDate ?? "").slice(0, 10);
  const next = (incomingDate ?? "").slice(0, 10);
  if (!next) return false;
  if (!current) return true;
  return next >= current;
}

export function latestPurchaseForSupplier(
  records: PurchasePriceRecord[] | undefined,
  productId: string,
  supplierId: string
): PurchasePriceRecord | undefined {
  return (records ?? [])
    .filter((row) => row.productId === productId && row.supplierId === supplierId)
    .slice()
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt))[0];
}

export function rememberedCompareGroup(
  maps: SupplierItemMap[],
  ingredients: CostingIngredient[],
  supplierId: string | undefined,
  line: { name: string; sku?: string | null }
): IngredientCompareGroup | undefined {
  const mapped = rememberedMap(maps, supplierId, line);
  const fromMap = mapped?.compareGroupId
    ? listCompareGroups(ingredients).find((group) => group.id === mapped.compareGroupId)
    : undefined;
  if (fromMap) return fromMap;
  const ingredient = mapped ? ingredients.find((item) => item.id === mapped.inventoryProductId) : undefined;
  if (!ingredient?.compareGroupId) return undefined;
  return listCompareGroups(ingredients).find((group) => group.id === ingredient.compareGroupId);
}

export function listCompareProductPicks(input: {
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  maps?: SupplierItemMap[];
  offers?: SupplierOffer[];
}): CompareProductPick[] {
  const picks: CompareProductPick[] = [];
  const seen = new Set<string>();
  for (const map of input.maps ?? []) {
    const ingredient = input.ingredients.find((item) => item.id === map.inventoryProductId);
    if (!ingredient || ingredient.active === false) continue;
    const key = `${map.inventoryProductId}|${map.supplierId}|${map.supplierProductName}`;
    seen.add(key);
    picks.push({
      key,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      supplierId: map.supplierId,
      supplierName: input.suppliers.find((item) => item.id === map.supplierId)?.name ?? map.supplierId,
      supplierProductName: map.supplierProductName,
      sku: map.supplierSku,
    });
  }
  for (const offer of input.offers ?? []) {
    if (offer.active === false) continue;
    const ingredient = input.ingredients.find((item) => item.id === offer.productId);
    if (!ingredient) continue;
    const key = `${offer.productId}|${offer.supplierId}|${offer.supplierSku || ingredient.name}`;
    if (seen.has(key) || [...seen].some((item) => item.startsWith(`${offer.productId}|${offer.supplierId}|`))) continue;
    seen.add(key);
    picks.push({
      key,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      supplierId: offer.supplierId,
      supplierName: input.suppliers.find((item) => item.id === offer.supplierId)?.name ?? offer.supplierId,
      supplierProductName: offer.supplierSku || ingredient.name,
      sku: offer.supplierSku,
    });
  }
  for (const ingredient of input.ingredients) {
    if (ingredient.active === false) continue;
    if (picks.some((pick) => pick.ingredientId === ingredient.id)) continue;
    picks.push({
      key: `${ingredient.id}||${ingredient.name}`,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      supplierId: "",
      supplierName: "",
      supplierProductName: ingredient.name,
    });
  }
  return picks.sort((a, b) => a.supplierProductName.localeCompare(b.supplierProductName, "he"));
}

export function searchCompareProductPicks(picks: CompareProductPick[], query: string): CompareProductPick[] {
  const q = query.trim().toLowerCase();
  if (!q) return picks;
  return picks.filter((pick) =>
    `${pick.supplierProductName} ${pick.ingredientName} ${pick.supplierName} ${pick.sku ?? ""}`.toLowerCase().includes(q)
  );
}

export function cheapestGroupRow(rows: MaterialCompareRow[]): MaterialCompareRow | undefined {
  return cheapestComparableCohort(rows)
    .slice()
    .sort((a, b) => (a.displayUnitCost ?? Infinity) - (b.displayUnitCost ?? Infinity))[0];
}

export function partitionCompareRows(rows: MaterialCompareRow[]): { comparable: MaterialCompareRow[]; other: MaterialCompareRow[] } {
  return {
    comparable: rows.filter((row) => row.comparable),
    other: rows.filter((row) => !row.comparable),
  };
}

function namedSupplier(suppliers: Supplier[], name?: string): { id: string; name: string } {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return { id: "", name: "" };
  const key = normalizeIngredientName(trimmed);
  const match = suppliers.find((item) => normalizeIngredientName(item.name) === key);
  return { id: match?.id ?? "", name: match?.name ?? trimmed };
}

function blankCompareRow(partial: Partial<MaterialCompareRow> & Pick<MaterialCompareRow, "ingredientId" | "ingredientName" | "supplierId" | "supplierName" | "supplierProductName" | "displayUnit" | "reason">): MaterialCompareRow {
  return {
    packQuantity: null,
    packUnit: undefined,
    buyPrice: null,
    unitCost: null,
    displayUnitCost: null,
    vatBasis: "unknown",
    currency: "ILS",
    source: "purchase",
    complete: false,
    comparable: false,
    cheapest: false,
    gapAmount: null,
    gapPercent: null,
    savingsVsLine: null,
    ...partial,
  };
}

function appendMembersWithoutOffers(
  rows: MaterialCompareRow[],
  input: {
    ingredientIds: string[];
    ingredients: CostingIngredient[];
    suppliers: Supplier[];
    records?: PurchasePriceRecord[];
    maps?: SupplierItemMap[];
    lineVatBasis?: "net" | "gross" | "unknown";
  }
) {
  const covered = new Set(rows.map((row) => row.ingredientId));
  for (const ingredientId of input.ingredientIds) {
    if (covered.has(ingredientId)) continue;
    const ingredient = input.ingredients.find((item) => item.id === ingredientId);
    if (!ingredient) continue;
    const productRecords = (input.records ?? []).filter((row) => row.productId === ingredientId && row.supplierId);
    const supplierIds = [...new Set(productRecords.map((row) => row.supplierId))];
    if (supplierIds.length) {
      for (const supplierId of supplierIds) {
        const record = latestPurchaseForSupplier(productRecords, ingredientId, supplierId);
        if (!record) continue;
        const packUnit = record.unit;
        const packQuantity = record.packageQuantity ?? record.quantity ?? null;
        const packOk = packQuantity != null && packQuantity > 0 && Boolean(packUnit);
        const vatBasis: MaterialCompareRow["vatBasis"] =
          record.vatType === "exclusive" ? "net" : record.vatType === "inclusive" ? "gross" : "unknown";
        const buyPrice =
          input.lineVatBasis === "net"
            ? record.priceBeforeVat ?? record.unitPriceNet ?? null
            : record.priceIncludingVat ?? record.unitPriceGross ?? null;
        const unitCost = packOk && buyPrice != null && packUnit ? unitCostFromPackage(buyPrice, packQuantity, packUnit) : null;
        const base = packUnit ? baseUnitFor(packUnit) : ingredient.baseUnit;
        const displayUnit = displayUnitForBase(base);
        const displayUnitCost = toDisplayUnitCost(unitCost, base);
        const compatible = !packUnit || baseUnitFor(packUnit) === ingredient.baseUnit;
        const vatOk = input.lineVatBasis == null || input.lineVatBasis === "unknown" || vatBasis === input.lineVatBasis;
        const map = (input.maps ?? []).find((item) => item.inventoryProductId === ingredientId && item.supplierId === supplierId);
        const reason: CompareRowReason = !packOk ? "missing-pack" : unitCost == null ? "missing-price" : !compatible ? "unit-mismatch" : !vatOk ? "vat-mismatch" : null;
        rows.push(
          blankCompareRow({
            ingredientId,
            ingredientName: ingredient.name,
            supplierId,
            supplierName: input.suppliers.find((item) => item.id === supplierId)?.name ?? supplierId,
            supplierProductName: map?.supplierProductName || ingredient.name,
            packQuantity,
            packUnit,
            buyPrice,
            unitCost,
            displayUnitCost,
            displayUnit,
            vatBasis,
            purchaseDate: record.purchaseDate,
            invoiceNumber: null,
            complete: packOk && unitCost != null && unitCost > 0,
            comparable: packOk && unitCost != null && unitCost > 0 && compatible && vatOk && vatBasis !== "unknown",
            reason,
          })
        );
      }
      covered.add(ingredientId);
      continue;
    }
    const savedPrice = ingredient.purchasePrice > 0 ? ingredient.purchasePrice : null;
    const savedQty = ingredient.purchaseQuantity > 0 ? ingredient.purchaseQuantity : null;
    const savedUnit = ingredient.purchaseUnit;
    const catalog = savedPrice != null && savedQty != null && savedUnit ? { price: savedPrice, qty: savedQty, unit: savedUnit } : null;
    const supplier = namedSupplier(input.suppliers, ingredient.supplier);
    const base = catalog ? baseUnitFor(catalog.unit) : ingredient.baseUnit;
    rows.push(
      blankCompareRow({
        ingredientId,
        ingredientName: ingredient.name,
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierProductName: ingredient.name,
        packQuantity: catalog?.qty ?? null,
        packUnit: catalog?.unit,
        buyPrice: catalog?.price ?? null,
        displayUnit: displayUnitForBase(base),
        vatBasis: "unknown",
        reason: catalog ? "vat-mismatch" : "missing-price",
      })
    );
    covered.add(ingredientId);
  }
}

export function buildGroupCompareRows(input: {
  ingredientIds: string[];
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  offers: SupplierOffer[];
  records?: PurchasePriceRecord[];
  maps?: SupplierItemMap[];
  lineUnitCost?: number | null;
  lineVatBasis?: "net" | "gross" | "unknown";
}): MaterialCompareRow[] {
  const wanted = new Set(input.ingredientIds);
  const rows: MaterialCompareRow[] = [];
  for (const offer of input.offers) {
    if (!wanted.has(offer.productId) || offer.active === false) continue;
    const ingredient = input.ingredients.find((item) => item.id === offer.productId);
    if (!ingredient) continue;
    const record = latestPurchaseForSupplier(input.records, offer.productId, offer.supplierId);
    const packUnit = record?.unit ?? offer.lastUnit ?? offerPurchaseUnit(offer);
    const packQuantity = record?.packageQuantity ?? record?.quantity ?? offer.lastPackageQuantity ?? offer.packageQuantity ?? null;
    const vatBasis: MaterialCompareRow["vatBasis"] = record
      ? record.vatType === "exclusive"
        ? "net"
        : record.vatType === "inclusive"
          ? "gross"
          : "unknown"
      : offer.vatType === "exclusive"
        ? "net"
        : offer.vatType === "inclusive"
          ? "gross"
          : offer.lastPriceBeforeVat != null && offer.lastPriceIncludingVat != null
            ? "gross"
            : "unknown";
    const purchased = Boolean(record || offer.lastPurchaseDate || offer.lastPurchasedAt);
    const buyPrice = !purchased
      ? null
      : input.lineVatBasis === "net"
        ? record?.priceBeforeVat ?? record?.unitPriceNet ?? offer.lastPriceBeforeVat ?? offer.priceBeforeVat ?? null
        : record?.priceIncludingVat ??
          record?.unitPriceGross ??
          offer.lastPriceIncludingVat ??
          offer.priceIncludingVat ??
          offer.lastLineTotalGross ??
          null;
    const packOk = packQuantity != null && packQuantity > 0 && Boolean(packUnit);
    const unitCost = packOk && buyPrice != null && packUnit ? unitCostFromPackage(buyPrice, packQuantity, packUnit) : null;
    const displayUnit = displayUnitForBase(packUnit ? baseUnitFor(packUnit) : ingredient.baseUnit);
    const displayUnitCost = toDisplayUnitCost(unitCost, packUnit ? baseUnitFor(packUnit) : ingredient.baseUnit);
    const complete = packOk && unitCost != null && unitCost > 0;
    const compatible = !packUnit || baseUnitFor(packUnit) === ingredient.baseUnit || unitsShareBase(packUnit, ingredient.baseUnit);
    const vatOk =
      input.lineVatBasis == null ||
      input.lineVatBasis === "unknown" ||
      vatBasis === input.lineVatBasis;
    const map = (input.maps ?? []).find((item) => item.inventoryProductId === offer.productId && item.supplierId === offer.supplierId);
    const reason: CompareRowReason = !packOk
      ? "missing-pack"
      : unitCost == null
        ? "missing-price"
        : !compatible
          ? "unit-mismatch"
          : !vatOk
            ? "vat-mismatch"
            : null;
    rows.push({
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      supplierId: offer.supplierId,
      supplierName: input.suppliers.find((item) => item.id === offer.supplierId)?.name ?? offer.supplierId,
      supplierProductName: map?.supplierProductName || offer.supplierSku || ingredient.name,
      offerId: offer.id,
      packQuantity,
      packUnit,
      buyPrice,
      unitCost,
      displayUnitCost,
      displayUnit,
      vatBasis,
      currency: "ILS",
      purchaseDate: record?.purchaseDate || offer.lastPurchaseDate || offer.lastPurchasedAt,
      invoiceNumber: offer.lastInvoiceNumber ?? null,
      source: "purchase",
      complete,
      comparable: complete && compatible && vatOk,
      cheapest: false,
      gapAmount: null,
      gapPercent: null,
      reason,
      savingsVsLine: null,
    });
  }
  appendMembersWithoutOffers(rows, input);
  const cohort = cheapestComparableCohort(rows);
  const cheap = cheapestGroupRow(rows);
  return rows.map((row) => {
    const inCohort = cohort.some(
      (item) => item.ingredientId === row.ingredientId && item.supplierId === row.supplierId && item.offerId === row.offerId
    );
    const gapAmount =
      inCohort && row.displayUnitCost != null && cheap?.displayUnitCost != null ? row.displayUnitCost - cheap.displayUnitCost : null;
    return {
      ...row,
      cheapest: Boolean(cheap && inCohort && row.ingredientId === cheap.ingredientId && row.supplierId === cheap.supplierId && row.displayUnitCost === cheap.displayUnitCost),
      gapAmount,
      gapPercent: gapAmount != null && cheap?.displayUnitCost ? (gapAmount / cheap.displayUnitCost) * 100 : null,
      savingsVsLine:
        row.comparable && row.unitCost != null && input.lineUnitCost != null && input.lineUnitCost > row.unitCost
          ? input.lineUnitCost - row.unitCost
          : null,
    };
  });
}

function unitsShareBase(packUnit: PurchaseUnit, productBase: BaseUnit): boolean {
  return baseUnitFor(packUnit) === productBase;
}

export function lineUnitCostForCompare(line: {
  quantity: number | null;
  unit: PurchaseUnit | null;
  conversionFactor?: number | null;
  lineNet?: number | null;
  lineGross?: number | null;
  unitPrice?: number | null;
  vatType?: VatType;
}): { unitCost: number | null; vatBasis: MaterialCompareRow["vatBasis"] } {
  const qty = line.quantity && line.quantity > 0 ? line.quantity : null;
  if (!qty || !line.unit) return { unitCost: null, vatBasis: "unknown" };
  const pack = line.conversionFactor != null && line.conversionFactor > 0 ? qty * line.conversionFactor : qty;
  if (line.lineNet != null) {
    return { unitCost: unitCostFromPackage(line.lineNet, pack, line.unit), vatBasis: "net" };
  }
  if (line.lineGross != null) {
    return { unitCost: unitCostFromPackage(line.lineGross, pack, line.unit), vatBasis: "gross" };
  }
  if (line.unitPrice != null) {
    return {
      unitCost: unitCostFromPackage(line.unitPrice, pack, line.unit),
      vatBasis: line.vatType === "inclusive" ? "gross" : line.vatType === "exclusive" ? "net" : "unknown",
    };
  }
  return { unitCost: null, vatBasis: "unknown" };
}

export function suggestMaterialGroup(input: {
  line: { name: string; sku?: string | null; barcode?: string | null; productId?: string; matchKind?: string; matchConfirmed?: boolean };
  ingredients: CostingIngredient[];
  maps?: SupplierItemMap[];
  suppliers?: Supplier[];
  offers?: SupplierOffer[];
  supplierId?: string;
  pack?: { unit?: PurchaseUnit | null; packageQuantity?: number | null; conversion?: number | null };
  lineUnitCost?: number | null;
  lineVatBasis?: MaterialCompareRow["vatBasis"];
}): MaterialGroupSuggestion {
  const maps = input.maps ?? [];
  const mapped = rememberedMap(maps, input.supplierId, input.line);
  const packConflict = Boolean(mapped && input.pack && packFieldsConflict(mapped, input.pack));
  const auto =
    mapped && (input.line.matchKind === "mapped" || !input.line.productId || input.line.productId === mapped.inventoryProductId)
      ? input.ingredients.find((item) => item.id === mapped.inventoryProductId)
      : undefined;
  const candidates = similarMaterialCandidates(input.line, input.ingredients, maps).filter((item) => item.id !== auto?.id);
  const safeAuto = auto && (input.line.matchConfirmed || input.line.matchKind === "mapped" || input.line.matchKind === "exact");
  const rememberedGroup = rememberedCompareGroup(maps, input.ingredients, input.supplierId, input.line);
  const groups = listCompareGroups(input.ingredients).filter(
    (group) =>
      group.id === rememberedGroup?.id ||
      candidates.some((item) => group.memberIds.includes(item.id)) ||
      (auto && group.memberIds.includes(auto.id))
  );
  const memberIds = [
    ...new Set([
      ...(auto ? [auto.id] : []),
      ...candidates.map((item) => item.id),
      ...groups.flatMap((group) => group.memberIds),
    ]),
  ];
  const compareRows = memberIds.length
    ? buildGroupCompareRows({
        ingredientIds: memberIds,
        ingredients: input.ingredients,
        suppliers: input.suppliers ?? [],
        offers: input.offers ?? [],
        maps,
        lineUnitCost: input.lineUnitCost,
        lineVatBasis: input.lineVatBasis,
      })
    : [];
  const similarEnough = candidates.some((item) => item.score >= MATCH_SUGGEST_MIN && item.score < MATCH_SAFE_MIN) || candidates.length > 0;
  return {
    show: Boolean(!safeAuto && similarEnough) || packConflict,
    autoFill: auto ? { ingredientId: auto.id, name: auto.name } : undefined,
    packConflict,
    candidates,
    groups,
    compareRows,
  };
}

export function assignmentKeepsSourceAmounts<T extends Pick<PurchaseInvoiceLine, "unitPrice" | "lineNet" | "lineGross" | "quantity" | "rawName">>(
  line: T,
  productId: string
): T & { productId: string } {
  return { ...line, productId };
}

export function assignmentCreatesNoStock(kind: "same" | "compare" | "separate"): { stockDelta: 0; sourceUnchanged: true } {
  void kind;
  return { stockDelta: 0, sourceUnchanged: true };
}

export function posSalePriceIsNotBuyPrice(): true {
  return true;
}

export function compareUsesPurchaseOnly(source: "purchase" | "pos-sale"): boolean {
  return source === "purchase";
}

export function unitsComparableForGroup(a?: PurchaseUnit | null, b?: PurchaseUnit | null, productBase?: BaseUnit): boolean {
  if (!a || !b) return false;
  if (productBase && (baseUnitFor(a) !== productBase || baseUnitFor(b) !== productBase)) return false;
  return baseUnitFor(a) === baseUnitFor(b);
}
