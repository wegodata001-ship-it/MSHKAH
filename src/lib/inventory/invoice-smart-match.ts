import { aliasOverlap } from "@/lib/costing/ingredient-aliases";
import { normalizeIngredientName } from "@/lib/costing/names";
import { MATCH_SUGGEST_MIN, rankProductMatches } from "@/lib/inventory/product-match";
import type { CostingIngredient } from "@/lib/costing/types";
import { asVatType, guessUnit, needsReview, PRICE_ANOMALY_RATIO, type ExtractedInvoice } from "@/lib/inventory/invoice-extract";
import { validateInvoiceTotals } from "@/lib/inventory/invoice-archive";
import { cheapestOffer, offerNormalizedCost, unitCostFromPackage } from "@/lib/inventory/stock";
import { detectedVatRate, splitVat } from "@/lib/inventory/vat";
import { finalizeInvoiceLine, newInvoiceLineKey } from "@/lib/inventory/invoice-lines";
import { toDateOnly } from "@/lib/dates/normalize";
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
  suppliers: Supplier[],
  extras?: { phone?: string | null; vatNumber?: string | null }
): { supplier?: Supplier; alternatives: Supplier[]; kind: "exact" | "suggest" | "new" } {
  const tax = (taxId || extras?.vatNumber || "").replace(/\D/g, "");
  if (tax) {
    const byTax = suppliers.filter((item) => (item.taxId || "").replace(/\D/g, "") === tax);
    if (byTax.length === 1) return { supplier: byTax[0], alternatives: [], kind: "exact" };
    if (byTax.length > 1) return { alternatives: byTax, kind: "suggest" };
  }
  const phone = (extras?.phone || "").replace(/\D/g, "");
  if (phone.length >= 8) {
    const byPhone = suppliers.filter((item) => (item.phone || "").replace(/\D/g, "") === phone);
    if (byPhone.length === 1) return { supplier: byPhone[0], alternatives: [], kind: "suggest" };
    if (byPhone.length > 1) return { alternatives: byPhone, kind: "suggest" };
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

export function unrecognizedScannedSupplier(
  invoice: { supplierId?: string; supplierName?: string; supplierTaxId?: string },
  suppliers: Supplier[]
): string | null {
  const name = invoice.supplierName?.trim();
  if (!name || invoice.supplierId) return null;
  const match = matchSupplier(name, invoice.supplierTaxId, suppliers);
  return match.kind === "new" ? name : null;
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
  const ranked = rankProductMatches(line.name, ingredients);
  if (ranked[0] && ranked[0].score >= MATCH_SUGGEST_MIN) {
    const items = ranked
      .map((row) => ingredients.find((item) => item.id === row.productId))
      .filter((item): item is CostingIngredient => Boolean(item));
    return { item: items[0], kind: "suggest", alternatives: items.slice(1) };
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
  const vatRate = detectedVatRate(input.extraction.vatRate.value) ?? input.vatRate ?? null;
  const supplierGuess = matchSupplier(
    input.extraction.supplierName.value || input.extraction.businessName.value,
    input.extraction.taxId.value || input.extraction.supplierVatNumber.value,
    input.suppliers,
    { phone: input.extraction.supplierPhone.value, vatNumber: input.extraction.supplierVatNumber.value }
  );
  const supplier = supplierGuess.supplier;
  const lines: PurchaseInvoiceLine[] = input.extraction.lines.map((line) => {
    const match = matchInventoryProduct(line, input.ingredients, input.maps, supplier?.id);
    const ranked = rankProductMatches(line.name, input.ingredients);
    const confirmed = match.kind === "exact" || match.kind === "mapped";
    const unit = guessUnit(line.unit);
    const qty = line.quantity;
    const unitPrice = line.unitPrice;
    const detectedVat = asVatType(line.vatType);
    const vatType = detectedVat ?? "unknown";
    const amount = line.lineNet ?? line.lineGross ?? line.lineTotal ?? (qty && unitPrice != null ? qty * unitPrice - (line.discount || 0) : null);
    const lineVatRate = detectedVatRate(line.vatRate) ?? (vatType === "unknown" ? null : vatRate);
    const matchConfidence =
      match.kind === "mapped" || match.kind === "exact"
        ? 0.99
        : ranked[0]?.score ?? (match.kind === "suggest" && match.item ? aliasOverlap(line.name, match.item.name) : null);
    const vat =
      vatType === "unknown"
        ? {
            priceBeforeVat: line.lineNet ?? line.priceBeforeVat,
            vatAmount: line.vatAmount,
            priceIncludingVat: line.lineGross ?? line.priceIncludingVat,
          }
        : splitVat({ amount: amount || 0, vatType, vatRate: lineVatRate });
    const normalized =
      qty && unit && (vat.priceIncludingVat ?? vat.priceBeforeVat)
        ? unitCostFromPackage(
            vat.priceIncludingVat ?? vat.priceBeforeVat ?? 0,
            line.conversionFactor && line.conversionFactor > 0 ? qty * line.conversionFactor : qty,
            unit
          )
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
    let rowStatus: PurchaseInvoiceLine["rowStatus"] = confirmed ? "matched" : "review";
    if (!match.item) rowStatus = match.kind === "new" ? "new" : "unmapped";
    else if (!confirmed) rowStatus = "review";
    else if (!unit || qty == null || unitPrice == null || !detectedVat) rowStatus = "review";
    else if (change != null && Math.abs(change) >= PRICE_ANOMALY_RATIO) rowStatus = "price-anomaly";
    else if (needsReview(confidence) || needsReview(matchConfidence)) rowStatus = "review";
    return finalizeInvoiceLine(
      {
        key: newInvoiceLineKey(),
        rawName: line.originalDescription || line.name,
        originalDescription: line.originalDescription || line.name,
        productId: match.item?.id,
        quantity: qty,
        unit,
        unitPrice: line.unitPriceNet ?? unitPrice,
        discount: line.discountAmount ?? line.discount,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount ?? line.discount,
        lineTotal: amount,
        lineNet: line.lineNet ?? vat.priceBeforeVat,
        lineGross: line.lineGross ?? vat.priceIncludingVat,
        vatType,
        taxMode: vatType,
        vatRate: lineVatRate,
        priceBeforeVat: line.priceBeforeVat ?? vat.priceBeforeVat ?? null,
        vatAmount: line.vatAmount ?? vat.vatAmount ?? null,
        priceIncludingVat: line.priceIncludingVat ?? vat.priceIncludingVat ?? null,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        confidence,
        matchConfidence,
        matchKind: match.kind,
        sku: line.sku ?? undefined,
        barcode: line.barcode ?? undefined,
        conversionNote: line.conversionNote ?? undefined,
        conversionFactor: line.conversionFactor,
        needsReview: rowStatus !== "matched" || vatType === "unknown",
        rowStatus: vatType === "unknown" && rowStatus === "matched" ? "review" : rowStatus,
        previousNormalized,
        newNormalized: normalized,
        priceChangePercent: change != null ? change * 100 : null,
        cheaperSupplierName: cheaper ? input.suppliers.find((item) => item.id === cheaper.supplierId)?.name : undefined,
        cheaperSupplierPrice: cheaper ? cheapCost : null,
        category: match.item?.category,
        matchConfirmed: confirmed,
        candidates: ranked,
        lineType: line.lineType,
        lineNumber: line.lineNumber,
        rawText: line.rawText,
        skipInventory: Boolean(line.lineType && line.lineType !== "INVENTORY_ITEM" && line.lineType !== "UNKNOWN"),
      },
      lineVatRate
    );
  });

  const headerNeedsReview =
    needsReview(input.extraction.supplierName.confidence) ||
    needsReview(input.extraction.invoiceNumber.confidence) ||
    needsReview(input.extraction.invoiceDate.confidence) ||
    supplierGuess.kind !== "exact" ||
    lines.some((line) => line.needsReview);

  const validation = validateInvoiceTotals({
    lines,
    headerNet: input.extraction.subtotal.value,
    headerVat: input.extraction.vatTotal.value,
    headerGross: input.extraction.grandTotal.value,
    headerDiscount: input.extraction.discountTotal.value ?? input.extraction.headerDiscount.value,
  });

  return {
    id: "",
    supplierId: supplier?.id,
    supplierName: supplier?.name || input.extraction.supplierName.value || input.extraction.businessName.value || "",
    supplierTaxId: input.extraction.taxId.value ?? input.extraction.supplierVatNumber.value ?? undefined,
    supplierVatNumber: input.extraction.supplierVatNumber.value ?? undefined,
    supplierPhone: input.extraction.supplierPhone.value ?? undefined,
    supplierAddress: input.extraction.supplierAddress.value ?? undefined,
    supplierSnapshot: supplier
      ? { id: supplier.id, name: supplier.name, taxId: supplier.taxId, phone: supplier.phone, address: supplier.address }
      : undefined,
    invoiceNumber: input.extraction.invoiceNumber.value || "",
    invoiceDate: toDateOnly(input.extraction.invoiceDate.value) || "",
    dueDate: toDateOnly(input.extraction.dueDate.value) ?? undefined,
    receivedAt: new Date().toISOString().slice(0, 10),
    documentType: input.extraction.documentType.value ?? undefined,
    currency: input.extraction.currency.value ?? undefined,
    paymentMethod: input.extraction.paymentMethod.value,
    paymentTerms: input.extraction.paymentTerms.value,
    headerDiscount: input.extraction.headerDiscount.value,
    vatRate: input.extraction.vatRate.value,
    netAmount: input.extraction.subtotal.value,
    vatAmount: input.extraction.vatTotal.value,
    grossAmount: input.extraction.grandTotal.value,
    subtotal: input.extraction.subtotal.value,
    vatTotal: input.extraction.vatTotal.value,
    grandTotal: input.extraction.grandTotal.value,
    subtotalBeforeDiscount: input.extraction.subtotalBeforeDiscount.value,
    discountTotal: input.extraction.discountTotal.value,
    shipping: input.extraction.shipping.value,
    delivery: input.extraction.delivery.value,
    serviceCharge: input.extraction.serviceCharge.value,
    rounding: input.extraction.rounding.value,
    otherCharges: input.extraction.otherCharges.value,
    vatStatus: input.extraction.vatStatus,
    status: headerNeedsReview || validation.hasMismatch ? "needs_review" : "draft",
    scanStatus: headerNeedsReview || validation.hasMismatch ? "needs_review" : "ready",
    stockStatus: "none",
    lines,
    validation,
    headerConfidence: {
      supplier: input.extraction.supplierName.confidence,
      invoiceNumber: input.extraction.invoiceNumber.confidence,
      invoiceDate: input.extraction.invoiceDate.confidence,
      vat: input.extraction.vatTotal.confidence ?? input.extraction.vatRate.confidence,
    },
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
    createdBy: input.actor,
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
