import { aliasOverlap } from "@/lib/costing/ingredient-aliases";
import { normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient } from "@/lib/costing/types";
import { asVatType, guessUnit, needsReview, PRICE_ANOMALY_RATIO, type ExtractedInvoice } from "@/lib/inventory/invoice-extract";
import { cheapestOffer, offerNormalizedCost, unitCostFromPackage } from "@/lib/inventory/stock";
import { DEFAULT_VAT_RATE, splitVat } from "@/lib/inventory/vat";
import { finalizeInvoiceLine, newInvoiceLineKey } from "@/lib/inventory/invoice-lines";
import type {
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchasePriceRecord,
  Supplier,
  SupplierItemMap,
  SupplierOffer,
} from "@/lib/inventory/types";

export function matchSupplier(
  name: string | null | undefined,
  taxId: string | null | undefined,
  suppliers: Supplier[]
): { supplier?: Supplier; alternatives: Supplier[]; kind: "exact" | "suggest" | "new" } {
  const tax = (taxId || "").replace(/\D/g, "");
  if (tax) {
    const byTax = suppliers.filter((item) => (item.taxId || "").replace(/\D/g, "") === tax);
    if (byTax.length === 1) return { supplier: byTax[0], alternatives: [], kind: "exact" };
    if (byTax.length > 1) return { alternatives: byTax, kind: "suggest" };
  }
  const target = normalizeIngredientName(name || "");
  if (!target) return { alternatives: [], kind: "new" };
  const exact = suppliers.filter((item) => normalizeIngredientName(item.name) === target);
  if (exact.length === 1) return { supplier: exact[0], alternatives: [], kind: "exact" };
  if (exact.length > 1) return { alternatives: exact, kind: "suggest" };
  const fuzzy = suppliers.filter((item) => {
    const n = normalizeIngredientName(item.name);
    return n.length >= 3 && target.length >= 3 && (n.includes(target) || target.includes(n));
  });
  if (fuzzy.length === 1) return { supplier: fuzzy[0], alternatives: [], kind: "suggest" };
  if (fuzzy.length > 1) return { alternatives: fuzzy, kind: "suggest" };
  return { alternatives: [], kind: "new" };
}

export function matchInventoryProduct(
  line: { name: string; sku?: string | null; barcode?: string | null },
  ingredients: CostingIngredient[],
  maps: SupplierItemMap[],
  supplierId?: string
): { item?: CostingIngredient; kind: PurchaseInvoiceLine["matchKind"]; alternatives: CostingIngredient[] } {
  const mapped = maps.find((item) => {
    if (supplierId && item.supplierId !== supplierId) return false;
    if (line.sku && item.supplierSku && item.supplierSku === line.sku) return true;
    return normalizeIngredientName(item.supplierProductName) === normalizeIngredientName(line.name);
  });
  if (mapped) {
    const item = ingredients.find((row) => row.id === mapped.inventoryProductId);
    if (item) return { item, kind: "mapped", alternatives: [] };
  }
  if (line.barcode) {
    const byBarcode = ingredients.filter((item) => item.barcode && item.barcode === line.barcode);
    if (byBarcode.length === 1) return { item: byBarcode[0], kind: "exact", alternatives: [] };
    if (byBarcode.length > 1) return { alternatives: byBarcode, kind: "suggest" };
  }
  const target = normalizeIngredientName(line.name);
  if (!target) return { alternatives: [], kind: "none" };
  const exact = ingredients.filter((item) => normalizeIngredientName(item.name) === target);
  if (exact.length === 1) return { item: exact[0], kind: "exact", alternatives: [] };
  if (exact.length > 1) return { alternatives: exact, kind: "suggest" };
  const fuzzy = ingredients.filter((item) => {
    const n = normalizeIngredientName(item.name);
    return n.length >= 3 && target.length >= 3 && (n.includes(target) || target.includes(n));
  });
  if (fuzzy.length === 1) return { item: fuzzy[0], kind: "suggest", alternatives: [] };
  if (fuzzy.length > 1) return { alternatives: fuzzy.slice(0, 6), kind: "suggest" };
  const aliased = ingredients
    .map((item) => ({ item, score: aliasOverlap(line.name, item.name) }))
    .filter((row) => row.score >= 0.8)
    .sort((a, b) => b.score - a.score);
  if (aliased[0] && (aliased.length === 1 || aliased[0].score - (aliased[1]?.score ?? 0) >= 0.04)) {
    return { item: aliased[0].item, kind: "suggest", alternatives: aliased.slice(1, 6).map((row) => row.item) };
  }
  return { alternatives: [], kind: "new" };
}

export function buildReviewedInvoice(input: {
  extraction: ExtractedInvoice;
  ingredients: CostingIngredient[];
  suppliers: Supplier[];
  offers: SupplierOffer[];
  records: PurchasePriceRecord[];
  maps: SupplierItemMap[];
  fileName: string;
  fileHash: string;
  fileUrl?: string;
  vatRate?: number;
  actor?: string;
}): PurchaseInvoice {
  const vatRate = input.vatRate ?? DEFAULT_VAT_RATE;
  const supplierGuess = matchSupplier(
    input.extraction.supplierName.value || input.extraction.businessName.value,
    input.extraction.taxId.value,
    input.suppliers
  );
  const supplier = supplierGuess.supplier;
  const lines: PurchaseInvoiceLine[] = input.extraction.lines.map((line) => {
    const match = matchInventoryProduct(line, input.ingredients, input.maps, supplier?.id);
    const unit = guessUnit(line.unit);
    const qty = line.quantity;
    const unitPrice = line.unitPrice;
    const detectedVat = asVatType(line.vatType);
    const vatType = detectedVat ?? "inclusive";
    const amount = line.lineTotal ?? (qty && unitPrice != null ? qty * unitPrice - (line.discount || 0) : 0);
    const matchConfidence =
      match.kind === "mapped" || match.kind === "exact" ? 0.99 : match.kind === "suggest" && match.item ? aliasOverlap(line.name, match.item.name) : null;
    const vat = splitVat({ amount: amount || 0, vatType, vatRate: line.vatAmount != null && amount ? vatRate : vatRate });
    const normalized =
      qty && unit && vat.priceIncludingVat
        ? unitCostFromPackage(vat.priceIncludingVat, line.conversionFactor && line.conversionFactor > 0 ? qty * line.conversionFactor : qty, unit)
        : null;
    const previous = match.item
      ? input.records
          .filter((row) => row.productId === match.item!.id && (!supplier || row.supplierId === supplier.id))
          .slice()
          .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))[0]
      : undefined;
    const previousNormalized = previous?.unitCost ?? null;
    const change =
      previousNormalized && normalized ? (normalized - previousNormalized) / previousNormalized : null;
    const itemOffers = match.item
      ? input.offers.filter((offer) => offer.productId === match.item!.id && offer.active !== false)
      : [];
    const cheap = cheapestOffer(itemOffers, match.item?.baseUnit);
    const cheapCost = cheap ? offerNormalizedCost(cheap) : null;
    const cheaper =
      cheap && cheap.supplierId !== supplier?.id && cheapCost != null && normalized != null && cheapCost + 0.00001 < normalized
        ? cheap
        : undefined;
    const confidence = line.confidence;
    let rowStatus: PurchaseInvoiceLine["rowStatus"] = "matched";
    if (!match.item) rowStatus = match.kind === "new" ? "new" : "unmapped";
    else if (!unit || qty == null || unitPrice == null || !detectedVat) rowStatus = "review";
    else if (change != null && Math.abs(change) >= PRICE_ANOMALY_RATIO) rowStatus = "price-anomaly";
    else if (needsReview(confidence) || needsReview(matchConfidence) || match.kind === "suggest") rowStatus = "review";
    return finalizeInvoiceLine(
      {
        key: newInvoiceLineKey(),
        rawName: line.name,
        productId: match.item?.id,
        quantity: qty,
        unit,
        unitPrice,
        discount: line.discount,
        lineTotal: amount || null,
        vatType,
        vatRate,
        priceBeforeVat: line.priceBeforeVat ?? vat.priceBeforeVat,
        vatAmount: line.vatAmount ?? vat.vatAmount,
        priceIncludingVat: line.priceIncludingVat ?? vat.priceIncludingVat,
        confidence,
        matchConfidence,
        matchKind: match.kind,
        sku: line.sku ?? undefined,
        barcode: line.barcode ?? undefined,
        conversionNote: line.conversionNote ?? undefined,
        conversionFactor: line.conversionFactor,
        needsReview: rowStatus !== "matched",
        rowStatus,
        previousNormalized,
        newNormalized: normalized,
        priceChangePercent: change != null ? change * 100 : null,
        cheaperSupplierName: cheaper ? input.suppliers.find((item) => item.id === cheaper.supplierId)?.name : undefined,
        cheaperSupplierPrice: cheaper ? cheapCost : null,
      },
      vatRate
    );
  });

  const headerNeedsReview =
    needsReview(input.extraction.supplierName.confidence) ||
    needsReview(input.extraction.invoiceNumber.confidence) ||
    needsReview(input.extraction.invoiceDate.confidence) ||
    supplierGuess.kind !== "exact" ||
    lines.some((line) => line.needsReview);

  return {
    id: "",
    supplierId: supplier?.id,
    supplierName: supplier?.name || input.extraction.supplierName.value || input.extraction.businessName.value || "",
    supplierTaxId: input.extraction.taxId.value ?? undefined,
    invoiceNumber: input.extraction.invoiceNumber.value || "",
    invoiceDate: input.extraction.invoiceDate.value || "",
    receivedAt: new Date().toISOString().slice(0, 10),
    documentType: input.extraction.documentType.value ?? undefined,
    currency: input.extraction.currency.value ?? undefined,
    subtotal: input.extraction.subtotal.value,
    vatTotal: input.extraction.vatTotal.value,
    grandTotal: input.extraction.grandTotal.value,
    vatStatus: input.extraction.vatStatus,
    status: headerNeedsReview ? "needs_review" : "draft",
    lines,
    fileName: input.fileName,
    fileUrl: input.fileUrl,
    fileHash: input.fileHash,
    aiProvider: "gemini",
    audit: [
      {
        at: new Date().toISOString(),
        actor: input.actor,
        action: "extract",
        detail: `${lines.length} lines`,
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

export function findDuplicateInvoice(
  invoices: Pick<PurchaseInvoice, "id" | "supplierId" | "invoiceNumber" | "invoiceDate" | "grandTotal" | "fileHash" | "status">[],
  candidate: Pick<PurchaseInvoice, "supplierId" | "invoiceNumber" | "invoiceDate" | "grandTotal" | "fileHash">
): PurchaseInvoice["id"] | undefined {
  const hit = invoices.find((item) => {
    if (item.status === "rejected") return false;
    if (candidate.fileHash && item.fileHash && item.fileHash === candidate.fileHash) return true;
    const sameIdentity = Boolean(
      candidate.supplierId &&
        item.supplierId === candidate.supplierId &&
        candidate.invoiceNumber &&
        item.invoiceNumber === candidate.invoiceNumber &&
        candidate.invoiceDate &&
        item.invoiceDate === candidate.invoiceDate
    );
    if (!sameIdentity) return false;
    if (candidate.grandTotal != null && item.grandTotal != null) return candidate.grandTotal === item.grandTotal;
    return true;
  });
  return hit?.id;
}
