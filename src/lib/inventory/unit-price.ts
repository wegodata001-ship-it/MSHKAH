import { roundMoney } from "@/lib/costing/money";
import type { PurchaseInvoiceLine, VatType } from "@/lib/inventory/types";

export type SourcePriceType = "including" | "excluding" | "exempt" | "unknown";

export type LineUnitPrices = {
  sourcePriceType: SourcePriceType;
  quantity: number;
  vatRate: number;
  unitPriceIncludingVat: number | null;
  unitPriceExcludingVat: number | null;
  lineTotalIncludingVat: number | null;
  lineTotalExcludingVat: number | null;
  vatAmount: number | null;
  /** The printed amount matched the unit price, so it was not divided by quantity again. */
  unitWasMisreadAsLine: boolean;
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeVatDecimal(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return 0;
  if (rate > 1) return rate / 100;
  return rate;
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.05, Math.abs(right) * 0.02);
}

export function deriveLineUnitPrices(input: {
  quantity: number | null | undefined;
  vatRate?: number | null;
  taxMode?: SourcePriceType | "inclusive" | "exclusive" | null;
  unitPrice?: number | null;
  unitPriceIncludingVat?: number | null;
  unitPriceExcludingVat?: number | null;
  lineTotalIncludingVat?: number | null;
  lineTotalExcludingVat?: number | null;
}): LineUnitPrices {
  const quantity = finite(input.quantity) ?? 0;
  const mode = input.taxMode === "exclusive" || input.taxMode === "excluding"
    ? "excluding"
    : input.taxMode === "exempt"
      ? "exempt"
      : input.taxMode === "unknown"
        ? "unknown"
        : "including";
  const vatRate = mode === "exempt" ? 0 : normalizeVatDecimal(input.vatRate);
  const factor = 1 + vatRate;
  let unitInc = finite(input.unitPriceIncludingVat);
  let unitEx = finite(input.unitPriceExcludingVat);
  let lineInc = finite(input.lineTotalIncludingVat);
  let lineEx = finite(input.lineTotalExcludingVat);
  const entered = finite(input.unitPrice);
  let unitWasMisreadAsLine = false;

  if (quantity > 1 && entered != null) {
    if (lineInc != null && close(lineInc, entered) && !close(lineInc, entered * quantity)) {
      unitInc = unitInc ?? lineInc;
      lineInc = null;
      unitWasMisreadAsLine = true;
      if (lineEx != null && unitInc != null && vatRate > 0 && close(lineEx, unitInc / factor)) {
        unitEx = unitEx ?? lineEx;
        lineEx = null;
      }
    }
    if (lineEx != null && close(lineEx, entered) && !close(lineEx, entered * quantity)) {
      unitEx = unitEx ?? lineEx;
      lineEx = null;
      unitWasMisreadAsLine = true;
      if (lineInc != null && unitEx != null && vatRate > 0 && close(lineInc, unitEx * factor)) {
        unitInc = unitInc ?? lineInc;
        lineInc = null;
      }
    }
  }

  if (quantity > 0 && lineInc != null && entered != null && close(lineInc, entered * quantity)) unitInc = entered;
  if (quantity > 0 && lineEx != null && entered != null && close(lineEx, entered * quantity)) unitEx = entered;
  if (unitInc == null && lineInc != null && quantity > 0) unitInc = lineInc / quantity;
  if (unitEx == null && lineEx != null && quantity > 0) unitEx = lineEx / quantity;
  if (lineInc == null && unitInc != null && quantity > 0) lineInc = unitInc * quantity;
  if (lineEx == null && unitEx != null && quantity > 0) lineEx = unitEx * quantity;

  if (vatRate === 0) {
    if (unitInc == null) unitInc = unitEx;
    if (unitEx == null) unitEx = unitInc;
    if (lineInc == null) lineInc = lineEx;
    if (lineEx == null) lineEx = lineInc;
  } else {
    if (unitInc != null && unitEx == null) unitEx = unitInc / factor;
    if (unitEx != null && unitInc == null) unitInc = unitEx * factor;
    if (lineInc != null && lineEx == null) lineEx = lineInc / factor;
    if (lineEx != null && lineInc == null) lineInc = lineEx * factor;
  }

  const vatAmount = lineInc != null && lineEx != null ? roundMoney(lineInc - lineEx) : null;
  return {
    sourcePriceType: vatRate === 0 ? "exempt" : mode,
    quantity,
    vatRate,
    unitPriceIncludingVat: unitInc == null ? null : roundMoney(unitInc),
    unitPriceExcludingVat: unitEx == null ? null : roundMoney(unitEx),
    lineTotalIncludingVat: lineInc == null ? null : roundMoney(lineInc),
    lineTotalExcludingVat: lineEx == null ? null : roundMoney(lineEx),
    vatAmount,
    unitWasMisreadAsLine,
  };
}

export type StoredPurchasePrice = {
  quantity?: number | null;
  packageQuantity?: number | null;
  purchaseQuantity?: number | null;
  priceBeforeVat?: number | null;
  priceIncludingVat?: number | null;
  unitPriceNet?: number | null;
  unitPriceGross?: number | null;
  lineTotalNet?: number | null;
  lineTotalGross?: number | null;
  vatRate?: number | null;
};

/** Unit prices for a saved purchase. A unit price is not divided by quantity again. */
export function storedPurchaseUnitPrices(record: StoredPurchasePrice): {
  unitExcludingVat: number | null;
  unitIncludingVat: number | null;
  quantity: number;
  dividedTwice: boolean;
} {
  const quantity = finite(record.purchaseQuantity) || finite(record.packageQuantity) || finite(record.quantity) || 0;
  const qty = quantity > 0 ? quantity : 1;
  const before = finite(record.priceBeforeVat);
  const including = finite(record.priceIncludingVat);
  const unitNet = finite(record.unitPriceNet);
  const unitGross = finite(record.unitPriceGross);
  const lineNet = finite(record.lineTotalNet);
  const lineGross = finite(record.lineTotalGross);
  const hasLine = lineNet != null || lineGross != null;
  const derived = deriveLineUnitPrices({
    quantity: qty,
    vatRate: record.vatRate,
    taxMode: "including",
    unitPrice: unitGross ?? unitNet,
    unitPriceIncludingVat: unitGross,
    unitPriceExcludingVat: unitNet,
    lineTotalIncludingVat: hasLine ? lineGross ?? including : null,
    lineTotalExcludingVat: hasLine ? lineNet ?? before : null,
  });

  if (hasLine && derived.unitPriceExcludingVat != null) {
    return {
      unitExcludingVat: derived.unitPriceExcludingVat,
      unitIncludingVat: derived.unitPriceIncludingVat,
      quantity: qty,
      dividedTwice: false,
    };
  }

  if (unitNet != null && before != null && close(unitNet * qty, before)) {
    return {
      unitExcludingVat: roundMoney(unitNet),
      unitIncludingVat: unitGross ?? (including != null && qty > 0 ? roundMoney(including / qty) : derived.unitPriceIncludingVat),
      quantity: qty,
      dividedTwice: false,
    };
  }

  if (before != null || including != null) {
    const unitEx = before ?? (including != null ? including / (1 + normalizeVatDecimal(record.vatRate ?? 0.18)) : null);
    const unitInc = including ?? (before != null ? before * (1 + normalizeVatDecimal(record.vatRate ?? 0.18)) : null);
    return {
      unitExcludingVat: unitEx == null ? null : roundMoney(unitEx),
      unitIncludingVat: unitInc == null ? null : roundMoney(unitInc),
      quantity: qty,
      dividedTwice: qty > 1 && unitNet == null && !hasLine,
    };
  }

  return { unitExcludingVat: null, unitIncludingVat: null, quantity: qty, dividedTwice: false };
}

export type LinePriceBasis = "including" | "excluding" | "exempt" | "unknown";
export type LineMoneyAnchor = "unitPrice" | "lineTotal";

export type LineMoneyEdit =
  | { field: "quantity"; quantity: number | null }
  | { field: "unitPrice"; unitPrice: number | null }
  | { field: "lineTotal"; lineTotal: number | null }
  | { field: "discount"; discount: number | null }
  | { field: "vatRate"; vatRate: number | null }
  | { field: "basis"; basis: LinePriceBasis };

export type ShownLinePrices = {
  basis: LinePriceBasis;
  quantity: number | null;
  unit: number | null;
  line: number | null;
  discount: number;
  unitExcludingVat: number | null;
  unitIncludingVat: number | null;
  lineExcludingVat: number | null;
  lineIncludingVat: number | null;
  vatAmount: number | null;
};

type MoneyLine = Pick<
  PurchaseInvoiceLine,
  | "quantity"
  | "unitPrice"
  | "discount"
  | "discountAmount"
  | "lineTotal"
  | "lineNet"
  | "lineGross"
  | "priceBeforeVat"
  | "priceIncludingVat"
  | "netAmount"
  | "grossAmount"
  | "unitPriceNet"
  | "unitPriceGross"
  | "unitPriceExcludingVat"
  | "unitPriceIncludingVat"
  | "lineTotalExcludingVat"
  | "lineTotalIncludingVat"
  | "vatType"
  | "taxMode"
  | "vatMode"
  | "vatRate"
  | "vatAmount"
  | "priceIncludesVat"
  | "lastEditedField"
  | "originalUnitPrice"
  | "originalLineTotal"
>;

export function linePriceBasis(line: Pick<PurchaseInvoiceLine, "vatType" | "taxMode" | "vatMode" | "priceIncludesVat">): LinePriceBasis {
  if (line.vatType === "exempt" || line.taxMode === "exempt" || line.vatMode === "exempt") return "exempt";
  if (line.priceIncludesVat === true) return "including";
  if (line.priceIncludesVat === false) return "excluding";
  if (line.vatType === "inclusive" || line.taxMode === "inclusive" || line.vatMode === "inclusive") return "including";
  if (line.vatType === "exclusive" || line.taxMode === "exclusive" || line.vatMode === "exclusive") return "excluding";
  return "unknown";
}

function moneyOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? roundMoney(value) : null;
}

function lineDiscount(line: Pick<PurchaseInvoiceLine, "discount" | "discountAmount">): number {
  return moneyOrNull(line.discountAmount ?? line.discount) ?? 0;
}

function basisVatType(basis: LinePriceBasis): VatType {
  if (basis === "including") return "inclusive";
  if (basis === "excluding") return "exclusive";
  if (basis === "exempt") return "exempt";
  return "unknown";
}

export function shownLinePrices(line: MoneyLine): ShownLinePrices {
  const basis = linePriceBasis(line);
  const quantity = finite(line.quantity);
  const discount = lineDiscount(line);
  const edited = line.lastEditedField != null;
  let unit = edited
    ? finite(line.unitPrice)
    : basis === "including"
      ? finite(line.unitPriceIncludingVat) ?? finite(line.unitPriceGross) ?? finite(line.unitPrice)
      : basis === "excluding" || basis === "exempt"
        ? finite(line.unitPriceExcludingVat) ?? finite(line.unitPriceNet) ?? finite(line.unitPrice)
        : finite(line.unitPrice) ?? finite(line.unitPriceNet) ?? finite(line.unitPriceGross);
  let total = edited
    ? basis === "including"
      ? finite(line.lineTotalIncludingVat) ?? finite(line.lineGross) ?? finite(line.priceIncludingVat) ?? finite(line.lineTotal)
      : basis === "excluding" || basis === "exempt"
        ? finite(line.lineTotalExcludingVat) ?? finite(line.lineNet) ?? finite(line.priceBeforeVat) ?? finite(line.lineTotal)
        : finite(line.lineTotal) ?? finite(line.lineNet) ?? finite(line.lineGross)
    : basis === "including"
      ? finite(line.lineTotalIncludingVat) ?? finite(line.lineGross) ?? finite(line.priceIncludingVat) ?? finite(line.grossAmount)
      : basis === "excluding" || basis === "exempt"
        ? finite(line.lineTotalExcludingVat) ?? finite(line.lineNet) ?? finite(line.priceBeforeVat) ?? finite(line.netAmount)
        : finite(line.lineTotal) ?? finite(line.lineNet) ?? finite(line.priceBeforeVat) ?? finite(line.lineGross);
  if (total == null && unit != null && quantity != null) total = roundMoney(quantity * unit - discount);
  if (unit == null && total != null && quantity != null && quantity !== 0) unit = roundMoney((total + discount) / quantity);
  const storedEx = finite(line.unitPriceExcludingVat) ?? finite(line.unitPriceNet);
  const storedInc = finite(line.unitPriceIncludingVat) ?? finite(line.unitPriceGross);
  const storedLineEx = finite(line.lineTotalExcludingVat) ?? finite(line.lineNet) ?? finite(line.priceBeforeVat);
  const storedLineInc = finite(line.lineTotalIncludingVat) ?? finite(line.lineGross) ?? finite(line.priceIncludingVat);
  return {
    basis,
    quantity,
    unit: unit == null ? null : roundMoney(unit),
    line: total == null ? null : roundMoney(total),
    discount,
    unitExcludingVat: storedEx,
    unitIncludingVat: storedInc,
    lineExcludingVat: storedLineEx,
    lineIncludingVat: storedLineInc,
    vatAmount: finite(line.vatAmount),
  };
}

function splitEntered(unit: number | null, total: number | null, basis: LinePriceBasis, rate: number) {
  if (basis === "unknown") {
    return { unitEx: null, unitInc: null, lineEx: null, lineInc: null, vat: null };
  }
  if (basis === "exempt" || rate <= 0) {
    return {
      unitEx: unit,
      unitInc: unit,
      lineEx: total,
      lineInc: total,
      vat: total == null ? null : 0,
    };
  }
  const factor = 1 + rate;
  if (basis === "including") {
    const lineEx = total == null ? null : roundMoney(total / factor);
    return {
      unitEx: unit == null ? null : roundMoney(unit / factor),
      unitInc: unit,
      lineEx,
      lineInc: total,
      vat: total == null || lineEx == null ? null : roundMoney(total - lineEx),
    };
  }
  const lineInc = total == null ? null : roundMoney(total * factor);
  return {
    unitEx: unit,
    unitInc: unit == null ? null : roundMoney(unit * factor),
    lineEx: total,
    lineInc,
    vat: total == null || lineInc == null ? null : roundMoney(lineInc - total),
  };
}

/** Update one price field. Quantity uses the last edited amount and never divides a unit price twice. */
export function applyInvoiceLineMoney(line: PurchaseInvoiceLine, edit: LineMoneyEdit, fallbackVatRate = 0.18): Partial<PurchaseInvoiceLine> {
  const previous = shownLinePrices(line);
  const basis = edit.field === "basis" ? edit.basis : previous.basis;
  let quantity = previous.quantity;
  let unit = previous.unit;
  let total = previous.line;
  let discount = previous.discount;
  let vatRate = line.vatRate;
  let anchor: LineMoneyAnchor = line.lastEditedField === "lineTotal" ? "lineTotal" : "unitPrice";

  if (edit.field === "quantity") quantity = edit.quantity == null || !Number.isFinite(edit.quantity) ? null : edit.quantity;
  if (edit.field === "unitPrice") {
    unit = moneyOrNull(edit.unitPrice);
    anchor = "unitPrice";
  }
  if (edit.field === "lineTotal") {
    total = moneyOrNull(edit.lineTotal);
    anchor = "lineTotal";
  }
  if (edit.field === "discount") discount = moneyOrNull(edit.discount) ?? 0;
  if (edit.field === "vatRate") vatRate = edit.vatRate == null || !Number.isFinite(edit.vatRate) ? null : edit.vatRate;
  if (edit.field === "basis" && edit.basis === "exempt") vatRate = 0;

  const rate = basis === "exempt" ? 0 : basis === "unknown" ? 0 : normalizeVatDecimal(vatRate ?? fallbackVatRate);
  const canDivide = quantity != null && quantity !== 0;
  if (anchor === "lineTotal" && total != null && canDivide) unit = roundMoney((total + discount) / quantity!);
  else if (anchor === "unitPrice" && unit != null && quantity != null) total = roundMoney(quantity * unit - discount);
  else if (total != null && canDivide) unit = roundMoney((total + discount) / quantity!);
  else if (unit != null && quantity != null) total = roundMoney(quantity * unit - discount);

  if (edit.field === "unitPrice" && unit == null) total = null;
  if (edit.field === "lineTotal" && total == null) unit = null;

  const split = splitEntered(unit, total, basis, rate);
  const vatType = basisVatType(basis);
  const enteredLine = basis === "including" ? split.lineInc : split.lineEx ?? total;
  return {
    quantity,
    unitPrice: unit,
    discount,
    discountAmount: discount,
    lineTotal: enteredLine,
    vatType,
    taxMode: vatType,
    vatMode: vatType,
    vatRate: basis === "exempt" ? 0 : basis === "unknown" ? vatRate : vatRate ?? fallbackVatRate,
    vatAmount: split.vat,
    priceIncludesVat: basis === "including" ? true : basis === "excluding" ? false : null,
    lastEditedField: anchor,
    sourcePriceType: basis,
    unitPriceExcludingVat: split.unitEx,
    unitPriceIncludingVat: split.unitInc,
    lineTotalExcludingVat: split.lineEx,
    lineTotalIncludingVat: split.lineInc,
    unitPriceNet: split.unitEx,
    unitPriceGross: split.unitInc,
    lineNet: split.lineEx,
    lineGross: split.lineInc,
    netAmount: split.lineEx,
    grossAmount: split.lineInc,
    priceBeforeVat: split.lineEx,
    priceIncludingVat: split.lineInc,
    originalUnitPrice: line.originalUnitPrice ?? previous.unit,
    originalLineTotal: line.originalLineTotal ?? previous.line,
    priceManuallyEdited: true,
  };
}
