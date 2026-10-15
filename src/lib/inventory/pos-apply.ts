import { catalogNames, matchProduct } from "@/lib/costing/import/match";
import { normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient, DishRecipe, PurchaseUnit } from "@/lib/costing/types";
import { purchaseQuantityInBase } from "@/lib/costing/units";
import { expandRecipeMaterials } from "@/lib/inventory/ingredient-core";
import { currentStockBase } from "@/lib/inventory/stock";
import { periodReviewCleared } from "@/lib/inventory/pos-excel";
import { isPosSummaryMetricLabel } from "@/lib/inventory/pos-summary-rows";
import type { InventoryMovement, PosImport, PosProductMap, PosSaleLine } from "@/lib/inventory/types";
import type { Product } from "@/types";
const RETURN_NAME = /החזר|זיכוי|החזרה|זיכויים|return|refund|credit|مرتجع|إرجاع|استرجاع|ائتمان/i;
const PRICE_GAP = 0.005;

export type PosLineKind = "sale" | "return";
export type PosIdentity = "existing" | "new" | "uncertain";
export type PosStockPath = "finished-unit" | "recipe";
export type PosInventoryStatus = "none" | "partial" | "posted";

export type PosPriceFields = {
  computedUnitPrice: number | null;
  sourceUnitPrice: number | null;
  priceGap: number | null;
  lineKind: PosLineKind;
};

export type PosStockImpact = {
  productId: string;
  label: string;
  quantity: number;
  unit: PurchaseUnit;
  quantityBase: number;
  balanceBefore: number;
  balanceAfter: number;
  goesNegative: boolean;
};

export type PosApplyRow = {
  key: string;
  sourceRow?: number;
  posName: string;
  posCode: string;
  quantity: number;
  reportedRevenue: number | null;
  computedUnitPrice: number | null;
  sourceUnitPrice: number | null;
  priceGap: number | null;
  lineKind: PosLineKind;
  identity: PosIdentity;
  menuProductId?: string;
  alternatives: { id: string; name: string }[];
  currentPrice: number | null;
  proposedPrice: number | null;
  updatePrice: boolean;
  stockPath: PosStockPath;
  impacts: PosStockImpact[];
  overlap?: { kind: "prior-import" | "orders" | "recipe-issue"; detail: string };
  reviewReasons: string[];
  createProduct: boolean;
  eligible: boolean;
};

export type PosApplyDecision = {
  menuProductId?: string;
  updatePrice?: boolean;
  proposedPrice?: number | null;
};

export type PosApplyPlan = {
  rows: PosApplyRow[];
  displayedCount: number;
  eligibleCount: number;
  excludedCount: number;
  manualExcludedCount: number;
  sourceItemCount: number | null;
  itemCountGap: number | null;
  selectedItemCount: number;
  selectedQuantitySum: number;
  selectedRevenueSum: number | null;
  sourceQuantitySum: number | null;
  sourceRevenueSum: number | null;
  createCount: number;
  priceUpdateCount: number;
  stockMovementCount: number;
  negativeCount: number;
  returnCount: number;
  periodNeedsReview: boolean;
  alreadyApplied: boolean;
  resumePartial: boolean;
  overlaps: PosApplyRow["overlap"][];
  blockers: ("empty" | "period-review" | "overlap-review" | "already-applied")[];
};

export function computedUnitPrice(revenue: number | null | undefined, quantity: number): number | null {
  if (!Number.isFinite(quantity) || quantity === 0) return null;
  if (revenue == null || !Number.isFinite(revenue)) return null;
  return revenue / quantity;
}

export function priceGap(source: number | null | undefined, computed: number | null | undefined): number | null {
  if (source == null || computed == null || !Number.isFinite(source) || !Number.isFinite(computed)) return null;
  const gap = computed - source;
  return Math.abs(gap) > PRICE_GAP ? gap : 0;
}

export function classifyPosLine(line: Pick<PosSaleLine, "posName" | "quantity">): PosLineKind {
  if (line.quantity < 0) return "return";
  return RETURN_NAME.test(line.posName ?? "") ? "return" : "sale";
}

export function isPosSummaryName(name: string): boolean {
  return isPosSummaryMetricLabel(name);
}

export function isValidPosBarcode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  const value = code.trim();
  return value.length >= 4 && value.length <= 32 && /^[0-9A-Za-z-]+$/.test(value);
}

export function isAutoProductRow(line: PosSaleLine): boolean {
  if (line.reviewReason === "missing-source-name" || line.reviewReason === "zero-quantity") return false;
  if (!line.posName?.trim() || isPosSummaryMetricLabel(line.posName)) return false;
  return true;
}

export function isEligiblePosProductRow(line: PosSaleLine, excludedKeys: string[] = []): boolean {
  if (line.excluded || excludedKeys.includes(line.key)) return false;
  return isAutoProductRow(line);
}

export function enrichSaleLine(line: PosSaleLine): PosSaleLine {
  const sourceUnitPrice = line.unitPrice ?? null;
  const computed = computedUnitPrice(line.reportedRevenue ?? line.netTotal ?? null, line.quantity);
  const reasons: PosSaleLine["reviewReason"][] = [];
  if (!line.posName?.trim()) reasons.push("missing-source-name");
  if (line.quantity === 0) reasons.push("zero-quantity");
  return {
    ...line,
    computedUnitPrice: computed,
    sourceUnitPrice,
    priceGap: priceGap(sourceUnitPrice, computed),
    lineKind: classifyPosLine(line),
    reviewReason: reasons[0] ?? line.reviewReason ?? null,
  };
}

export function matchPosIdentity(
  line: Pick<PosSaleLine, "posCode" | "posName" | "menuProductId" | "matchKind">,
  products: Product[],
  maps: PosProductMap[]
): { identity: PosIdentity; product?: Product; alternatives: Product[] } {
  if (line.menuProductId) {
    const mapped = products.find((item) => item.id === line.menuProductId);
    if (mapped && (line.matchKind === "exact" || line.matchKind === "suggest")) {
      return { identity: line.matchKind === "suggest" ? "uncertain" : "existing", product: mapped, alternatives: [] };
    }
    if (mapped) return { identity: "existing", product: mapped, alternatives: [] };
  }
  const mapped = line.posName || line.posCode
    ? maps.find((item) => (line.posCode && item.posCode === line.posCode) || (line.posName && item.posName === line.posName))
    : undefined;
  if (mapped?.menuProductId) {
    const product = products.find((item) => item.id === mapped.menuProductId);
    if (product) return { identity: "existing", product, alternatives: [] };
  }
  if (isValidPosBarcode(line.posCode)) {
    const byBarcode = products.filter((item) => (item.barcode ?? "").trim() === line.posCode.trim());
    if (byBarcode.length === 1) return { identity: "existing", product: byBarcode[0], alternatives: [] };
    if (byBarcode.length > 1) return { identity: "uncertain", alternatives: byBarcode };
  }
  const nameMatch = matchProduct("", line.posName, products);
  if (nameMatch.kind === "exact" && nameMatch.item) return { identity: "existing", product: nameMatch.item, alternatives: [] };
  if (nameMatch.alternatives.length || nameMatch.kind === "suggest") {
    return { identity: "uncertain", product: undefined, alternatives: nameMatch.item ? [nameMatch.item, ...nameMatch.alternatives] : nameMatch.alternatives };
  }
  return { identity: "new", alternatives: [] };
}

export function posCreatedProductId(importId: string, lineKey: string): string {
  const raw = `${importId}:${lineKey}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  return `posp_${importId.slice(0, 8)}_${Math.abs(hash).toString(36)}`;
}

export function posMovementId(importId: string, sourceRow: number | undefined, productId: string): string {
  return `posm_${importId}_${sourceRow ?? "x"}_${productId}`.replace(/[^\w-]/g, "_");
}

export function posSourceKey(line: Pick<PosSaleLine, "posName" | "posCode">): string {
  return `${normalizeIngredientName(line.posName)}|${(line.posCode ?? "").trim()}`;
}

function recipeForProduct(productId: string | undefined, recipes: DishRecipe[]): DishRecipe | undefined {
  if (!productId) return undefined;
  return recipes.find((item) => item.productId === productId && !item.variantId);
}

function impactLabel(productId: string, products: Product[], ingredients: CostingIngredient[]): string {
  const product = products.find((item) => item.id === productId);
  if (product) return catalogNames(product)[0] || product.name_he || product.name_ar || productId;
  return ingredients.find((item) => item.id === productId)?.name || productId;
}

function stockImpacts(input: {
  line: PosSaleLine;
  productId?: string;
  recipes: DishRecipe[];
  products: Product[];
  ingredients: CostingIngredient[];
  movements: InventoryMovement[];
}): { path: PosStockPath; impacts: PosStockImpact[] } {
  const qty = Number(input.line.quantity) || 0;
  if (!qty || !input.productId) return { path: "finished-unit", impacts: [] };
  const deltaSign = classifyPosLine(input.line) === "return" ? 1 : -1;
  const recipe = recipeForProduct(input.productId, input.recipes);
  if (recipe) {
    return {
      path: "recipe",
      impacts: expandRecipeMaterials(recipe, Math.abs(qty), input.recipes).map((material) => {
        const base = purchaseQuantityInBase(material.quantity, material.unit);
        const before = currentStockBase(input.movements, material.productId);
        const after = before + deltaSign * base;
        return {
          productId: material.productId,
          label: impactLabel(material.productId, input.products, input.ingredients),
          quantity: deltaSign * material.quantity,
          unit: material.unit,
          quantityBase: base,
          balanceBefore: before,
          balanceAfter: after,
          goesNegative: after < -0.0001,
        };
      }),
    };
  }
  const before = currentStockBase(input.movements, input.productId);
  const after = before + deltaSign * Math.abs(qty);
  return {
    path: "finished-unit",
    impacts: [
      {
        productId: input.productId,
        label: impactLabel(input.productId, input.products, input.ingredients) || input.line.posName,
        quantity: deltaSign * Math.abs(qty),
        unit: "unit",
        quantityBase: Math.abs(qty),
        balanceBefore: before,
        balanceAfter: after,
        goesNegative: after < -0.0001,
      },
    ],
  };
}

function findOverlap(input: {
  line: PosSaleLine;
  productId?: string;
  impacts: PosStockImpact[];
  movements: InventoryMovement[];
  imports: PosImport[];
  fileHash?: string;
}): PosApplyRow["overlap"] | undefined {
  const impactIds = new Set(input.impacts.map((item) => item.productId));
  if (input.productId) impactIds.add(input.productId);
  const priorSameFile = input.imports.filter(
    (item) => item.fileHash && item.fileHash === input.fileHash && item.inventoryStatus === "posted"
  );
  if (priorSameFile.length) return { kind: "prior-import", detail: priorSameFile[0]!.id };
  for (const movement of input.movements) {
    if (!impactIds.has(movement.productId)) continue;
    if (movement.type !== "SALE_OUT" && movement.type !== "ISSUE_OUT") continue;
    if (!movement.posImportId) continue;
    const other = input.imports.find((item) => item.id === movement.posImportId);
    if (other && other.fileHash && other.fileHash !== input.fileHash && other.inventoryStatus === "posted") {
      return { kind: "prior-import", detail: other.id };
    }
  }
  return undefined;
}

export type PosApplyBlockReason = {
  code: PosApplyPlan["blockers"][number];
  rowKey?: string;
};

export function posApplyBlockReasons(plan: PosApplyPlan): PosApplyBlockReason[] {
  return plan.blockers.map((code) => ({
    code,
    rowKey: code === "overlap-review" ? plan.rows.find((row) => row.overlap && row.eligible)?.key : undefined,
  }));
}

function defaultUpdatePrice(current: number | null, proposed: number | null): boolean {
  if (proposed == null || !Number.isFinite(proposed)) return false;
  if (proposed === 0 && (current ?? 0) > 0) return false;
  if (current == null) return proposed > 0;
  return Math.abs(proposed - current) > PRICE_GAP && proposed > 0;
}

export function planPosApply(input: {
  lines: PosSaleLine[];
  products: Product[];
  maps: PosProductMap[];
  recipes: DishRecipe[];
  ingredients?: CostingIngredient[];
  movements: InventoryMovement[];
  imports: PosImport[];
  fileHash?: string;
  sourceItemCount?: number | null;
  periodNeedsReview?: boolean;
  periodConfirmed?: boolean;
  periodFrom?: string | null;
  periodTo?: string | null;
  overlapAcknowledged?: boolean;
  decisions?: Record<string, PosApplyDecision>;
  excludedKeys?: string[];
  sourceQuantitySum?: number | null;
  sourceRevenueSum?: number | null;
}): PosApplyPlan {
  const ingredients = input.ingredients ?? [];
  const displayed = input.lines.map(enrichSaleLine);
  const already = input.imports.some(
    (item) => item.fileHash && item.fileHash === input.fileHash && item.inventoryStatus === "posted"
  );
  const resumePartial = input.imports.some(
    (item) => item.fileHash && item.fileHash === input.fileHash && item.inventoryStatus === "partial"
  );
  const rows = displayed.map((line) => {
    const decision = input.decisions?.[line.key];
    const chosenId = decision?.menuProductId === "" ? undefined : decision?.menuProductId || line.menuProductId;
    const match = matchPosIdentity({ ...line, menuProductId: chosenId, matchKind: chosenId && decision?.menuProductId ? "exact" : line.matchKind }, input.products, input.maps);
    const identity: PosIdentity =
      decision?.menuProductId === ""
        ? "new"
        : decision?.menuProductId
          ? "existing"
          : match.identity === "uncertain"
            ? "new"
            : match.identity;
    const product = decision?.menuProductId
      ? input.products.find((item) => item.id === decision.menuProductId)
      : identity === "new"
        ? undefined
        : match.product;
    const eligible = isEligiblePosProductRow(line, input.excludedKeys);
    const createProduct = Boolean(eligible && !product);
    const productId = product?.id ?? (createProduct ? posCreatedProductId("draft", line.key) : undefined);
    const stock = eligible
      ? stockImpacts({
          line,
          productId: product?.id,
          recipes: input.recipes,
          products: input.products,
          ingredients,
          movements: input.movements,
        })
      : { path: "finished-unit" as const, impacts: [] };
    const proposed =
      decision?.proposedPrice !== undefined ? decision.proposedPrice : line.computedUnitPrice;
    const current = product?.price ?? null;
    const reviewReasons: string[] = [];
    if (line.reviewReason) reviewReasons.push(line.reviewReason);
    if (line.quantity === 0) reviewReasons.push("zero-quantity");
    if (line.priceGap) reviewReasons.push("price-gap");
    if (match.identity === "uncertain" && identity === "new") reviewReasons.push("similar-kept-separate");
    if (stock.impacts.some((item) => item.goesNegative)) reviewReasons.push("negative-stock");
    const overlap = eligible
      ? findOverlap({
          line,
          productId: product?.id,
          impacts: stock.impacts,
          movements: input.movements,
          imports: input.imports,
          fileHash: input.fileHash,
        })
      : undefined;
    if (overlap) reviewReasons.push(`overlap-${overlap.kind}`);
    return {
      key: line.key,
      sourceRow: line.sourceRow,
      posName: line.posName,
      posCode: line.posCode,
      quantity: line.quantity,
      reportedRevenue: line.reportedRevenue ?? line.netTotal ?? null,
      computedUnitPrice: line.computedUnitPrice ?? null,
      sourceUnitPrice: line.sourceUnitPrice ?? line.unitPrice ?? null,
      priceGap: line.priceGap ?? null,
      lineKind: line.lineKind ?? classifyPosLine(line),
      identity,
      menuProductId: product?.id,
      alternatives: match.alternatives.map((item) => ({
        id: item.id,
        name: item.name_he || item.name_ar || item.name_en || item.id,
      })),
      currentPrice: current,
      proposedPrice: proposed ?? null,
      updatePrice: decision?.updatePrice ?? defaultUpdatePrice(current, proposed ?? null),
      stockPath: createProduct || !product ? ("finished-unit" as const) : stock.path,
      impacts: createProduct
        ? [
            {
              productId: productId || line.key,
              label: line.posName,
              quantity: Math.abs(line.quantity),
              unit: "unit" as const,
              quantityBase: Math.abs(line.quantity),
              balanceBefore: 0,
              balanceAfter: classifyPosLine(line) === "return" ? Math.abs(line.quantity) : -Math.abs(line.quantity),
              goesNegative: classifyPosLine(line) !== "return" && Math.abs(line.quantity) > 0,
            },
          ]
        : stock.impacts,
      overlap,
      reviewReasons,
      createProduct,
      eligible,
    } satisfies PosApplyRow;
  });
  const excluded = new Set(input.excludedKeys ?? []);
  const productRows = displayed.filter(isAutoProductRow);
  const eligible = rows.filter((row) => row.eligible);
  const selectedRevenue = eligible
    .map((row) => row.reportedRevenue)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const overlaps = [...new Map(eligible.filter((row) => row.overlap).map((row) => [row.overlap!.kind + row.overlap!.detail, row.overlap!])).values()];
  const blockers: PosApplyPlan["blockers"] = [];
  if (!eligible.length) blockers.push("empty");
  if (
    !periodReviewCleared({
      periodNeedsReview: input.periodNeedsReview,
      periodConfirmed: input.periodConfirmed,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
    })
  ) {
    blockers.push("period-review");
  }
  if (overlaps.length && !input.overlapAcknowledged) blockers.push("overlap-review");
  if (already) blockers.push("already-applied");
  return {
    rows,
    displayedCount: displayed.length,
    eligibleCount: eligible.length,
    excludedCount: displayed.length - productRows.length,
    manualExcludedCount: excluded.size,
    sourceItemCount: input.sourceItemCount ?? null,
    itemCountGap:
      input.sourceItemCount != null ? productRows.length - input.sourceItemCount : null,
    selectedItemCount: eligible.length,
    selectedQuantitySum: eligible.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
    selectedRevenueSum: selectedRevenue.length ? selectedRevenue.reduce((sum, value) => sum + value, 0) : null,
    sourceQuantitySum: input.sourceQuantitySum ?? null,
    sourceRevenueSum: input.sourceRevenueSum ?? null,
    createCount: eligible.filter((row) => row.createProduct).length,
    priceUpdateCount: eligible.filter((row) => row.updatePrice).length,
    stockMovementCount: eligible.reduce((sum, row) => sum + row.impacts.length, 0),
    negativeCount: eligible.filter((row) => row.impacts.some((item) => item.goesNegative)).length,
    returnCount: eligible.filter((row) => row.lineKind === "return").length,
    periodNeedsReview: Boolean(input.periodNeedsReview),
    alreadyApplied: already,
    resumePartial,
    overlaps,
    blockers,
  };
}

export function canApplyPosPlan(plan: PosApplyPlan): { ok: true } | { ok: false; reason: PosApplyPlan["blockers"][number] } {
  if (plan.blockers.includes("already-applied") && !plan.resumePartial) return { ok: false, reason: "already-applied" };
  const first = plan.blockers.find((item) => item !== "already-applied");
  if (first) return { ok: false, reason: first };
  if (plan.alreadyApplied && !plan.resumePartial) return { ok: false, reason: "already-applied" };
  return { ok: true };
}

export function movementAlreadyWritten(
  movements: InventoryMovement[],
  importId: string,
  sourceRow: number | undefined,
  productId: string
): boolean {
  const id = posMovementId(importId, sourceRow, productId);
  return movements.some(
    (row) =>
      row.id === id ||
      (row.posImportId === importId &&
        row.productId === productId &&
        (row.posSourceRow === sourceRow || row.idempotencyKey === `pos-${importId}-${sourceRow}-${productId}`))
  );
}
