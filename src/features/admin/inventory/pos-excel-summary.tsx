"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { dateLooksLikeEpoch, isValidSalesPeriod, periodReviewCleared } from "@/lib/inventory/pos-excel";
import { canApplyPosPlan, posApplyBlockReasons, type PosApplyDecision, type PosApplyPlan, type PosApplyRow } from "@/lib/inventory/pos-apply";
import type { Product } from "@/types";

export function PosExcelSummary({
  plan,
  products,
  periodLabel,
  periodFrom,
  periodTo,
  sourcePeriodFrom,
  sourcePeriodTo,
  periodNeedsReview,
  periodConfirmed,
  overlapAcknowledged,
  busy,
  error,
  onSavePeriod,
  onOverlapAck,
  onDecision,
  onApply,
  onSaveSales,
}: {
  plan: PosApplyPlan;
  products: Product[];
  periodLabel: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  sourcePeriodFrom?: string | null;
  sourcePeriodTo?: string | null;
  periodNeedsReview: boolean;
  periodConfirmed: boolean;
  overlapAcknowledged: boolean;
  busy: boolean;
  error?: string | null;
  onSavePeriod: (from: string, to: string) => void;
  onOverlapAck: (value: boolean) => void;
  onDecision: (key: string, decision: PosApplyDecision) => void;
  onApply: () => void;
  onSaveSales?: () => void;
}) {
  const t = useT();
  const eligible = plan.rows.filter((row) => row.eligible);
  const canApply = canApplyPosPlan(plan);
  const blockReasons = posApplyBlockReasons(plan);
  const periodCleared = periodReviewCleared({ periodNeedsReview, periodConfirmed, periodFrom, periodTo });
  const originalFrom = sourcePeriodFrom || periodFrom;
  const originalTo = sourcePeriodTo || periodTo;

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-beige/50 px-3 py-2 text-sm font-semibold">{t("admin.pos.infoOnly")}</p>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>{t("admin.pos.dataPeriod")}: {periodLabel || "—"}</p>
        <p>
          {t("admin.pos.sourceTotals")}: {plan.sourceItemCount ?? "—"} / {plan.sourceQuantitySum ?? "—"} / {plan.sourceRevenueSum == null ? "—" : formatIls(plan.sourceRevenueSum)}
        </p>
        <p>
          {t("admin.pos.selectedTotals")}: {plan.selectedItemCount} / {plan.selectedQuantitySum} / {plan.selectedRevenueSum == null ? "—" : formatIls(plan.selectedRevenueSum)}
        </p>
        {plan.itemCountGap ? <p>{t("admin.pos.totalsGap")}: {plan.itemCountGap}</p> : null}
        <p>{t("admin.pos.willCreate")}: {plan.createCount}</p>
        <p>{t("admin.pos.willUpdatePrices")}: {plan.priceUpdateCount}</p>
        <p>{t("admin.pos.willDeductStock")}: {plan.stockMovementCount}</p>
        {plan.negativeCount > 0 && <p className="text-amber-800">{t("admin.pos.negativeWarn")}: {plan.negativeCount}</p>}
        {plan.returnCount > 0 && <p>{t("admin.pos.returnRows")}: {plan.returnCount}</p>}
        {plan.manualExcludedCount > 0 && <p>{t("admin.pos.removedFromImport")}: {plan.manualExcludedCount}</p>}
        {plan.excludedCount > 0 && <p>{t("admin.pos.excludedRows")}: {plan.excludedCount}</p>}
      </div>
      <p className="text-sm text-coffee/70">{t("admin.pos.averageNotList")}</p>

      {periodNeedsReview && (
        <PeriodFixFields
          from={periodFrom}
          to={periodTo}
          originalFrom={originalFrom}
          originalTo={originalTo}
          saved={periodCleared}
          busy={busy}
          onSave={onSavePeriod}
        />
      )}
      {plan.overlaps.length > 0 && (
        <label id="pos-overlap-ack" className="flex items-start gap-2 text-sm text-amber-900">
          <input type="checkbox" checked={overlapAcknowledged} onChange={(e) => onOverlapAck(e.target.checked)} />
          <span>{t("admin.pos.overlapReview")}</span>
        </label>
      )}
      {plan.alreadyApplied && !plan.resumePartial && <p className="text-sm text-red-800">{t("admin.pos.alreadyApplied")}</p>}
      {plan.resumePartial && <p className="text-sm text-amber-800">{t("admin.pos.resumePartial")}</p>}

      <div className="overflow-x-auto rounded-2xl border border-beige-dark/20">
        <table className="min-w-[72rem] w-full text-sm">
          <thead className="bg-beige/40 text-start">
            <tr>
              <th className="p-2 font-medium">{t("admin.pos.productName")}</th>
              <th className="p-2 font-medium">{t("admin.pos.identity")}</th>
              <th className="p-2 font-medium">{t("admin.pos.soldQty")}</th>
              <th className="p-2 font-medium">{t("admin.pos.reportedRevenue")}</th>
              <th className="p-2 font-medium">{t("admin.pos.computedPrice")}</th>
              <th className="p-2 font-medium">{t("admin.pos.currentPrice")}</th>
              <th className="p-2 font-medium">{t("admin.pos.proposedPrice")}</th>
              <th className="p-2 font-medium">{t("admin.pos.stockImpact")}</th>
            </tr>
          </thead>
          <tbody>
            {eligible.map((row) => (
              <SummaryRow key={row.key} row={row} products={products} onDecision={onDecision} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        {busy && <p className="text-sm font-medium">{t("admin.pos.applying")}</p>}
        {!canApply.ok && !plan.resumePartial && (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {blockReasons.map((item) => (
              <p key={item.code}>
                {t(`admin.pos.block.${item.code}`)}
                {item.code === "overlap-review" && (
                  <>
                    {" "}
                    <a className="text-turquoise underline" href={item.rowKey ? `#pos-row-${item.rowKey}` : "#pos-overlap-ack"}>
                      {t("admin.pos.fixHere")}
                    </a>
                  </>
                )}
              </p>
            ))}
          </div>
        )}
        {error && !busy && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            <span>{error}</span>
            <Button type="button" variant="outline" onClick={onApply}>{t("admin.pos.retryApply")}</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {onSaveSales && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || plan.blockers.includes("period-review") || plan.blockers.includes("empty")}
              onClick={onSaveSales}
            >
              {t("admin.insight.saveSales")}
            </Button>
          )}
          <Button type="button" variant="turquoise" disabled={busy || (!canApply.ok && !plan.resumePartial)} onClick={onApply}>
            {busy ? t("admin.pos.applying") : t("admin.insight.updateStock")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PeriodFixFields({
  from,
  to,
  originalFrom,
  originalTo,
  saved,
  busy,
  onSave,
}: {
  from?: string | null;
  to?: string | null;
  originalFrom?: string | null;
  originalTo?: string | null;
  saved: boolean;
  busy: boolean;
  onSave: (from: string, to: string) => void;
}) {
  const t = useT();
  const [draftFrom, setDraftFrom] = useState(dateLooksLikeEpoch(from) ? "" : (from ?? ""));
  const [draftTo, setDraftTo] = useState(dateLooksLikeEpoch(to) ? "" : (to ?? ""));
  const valid = isValidSalesPeriod(draftFrom, draftTo);
  return (
    <div id="pos-period-ack" className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
      <p className="font-medium text-amber-950">{t("admin.pos.period1970Hint")}</p>
      {(originalFrom || originalTo) && (
        <p className="text-xs text-coffee/60">
          {t("admin.pos.originalPeriod")}: {originalFrom || "—"} – {originalTo || "—"}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-coffee/70">{t("admin.pos.periodFrom")}</span>
          <Input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
        </label>
        <label>
          <span className="mb-1 block text-coffee/70">{t("admin.pos.periodTo")}</span>
          <Input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
        </label>
      </div>
      {!valid && <p className="text-xs text-amber-900">{t("admin.pos.periodStillInvalid")}</p>}
      {saved && <p className="text-xs text-emerald-800">{t("admin.pos.periodSaved")}</p>}
      <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => onSave(draftFrom, draftTo)}>
        {t("admin.pos.savePeriodContinue")}
      </Button>
    </div>
  );
}

function SummaryRow({
  row,
  products,
  onDecision,
}: {
  row: PosApplyRow;
  products: Product[];
  onDecision: (key: string, decision: PosApplyDecision) => void;
}) {
  const t = useT();
  const impact = row.impacts
    .map((item) => `${item.label}: ${item.quantity > 0 ? "+" : ""}${item.quantity} ${item.unit} → ${item.balanceAfter}`)
    .join(" · ");
  return (
    <tr id={`pos-row-${row.key}`} className="border-t border-beige-dark/15 align-top">
      <td className="max-w-[14rem] whitespace-pre-wrap break-words p-2 font-medium">
        {row.posName}
        {row.lineKind === "return" && <p className="text-xs font-normal text-coffee/60">{t("admin.pos.returnRow")}</p>}
        {row.priceGap ? <p className="text-xs font-normal text-amber-800">{t("admin.pos.priceGap")}: {formatIls(row.priceGap)}</p> : null}
      </td>
      <td className="p-2">
        <p>{row.createProduct ? t("admin.pos.identityNew") : t("admin.pos.identityExisting")}</p>
        {row.createProduct && row.alternatives.length > 0 && (
          <p className="text-xs text-coffee/60">{t("admin.pos.similarOptional")}</p>
        )}
        {(row.identity !== "existing" || row.alternatives.length > 0) && (
          <select
            className="mt-1 h-9 w-full min-w-[8rem] rounded-lg border px-2"
            value={row.menuProductId ?? ""}
            onChange={(e) => onDecision(row.key, { menuProductId: e.target.value })}
          >
            <option value="">{t("admin.pos.identityNew")}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name_he || product.name_ar || product.name_en}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="p-2">{row.quantity}</td>
      <td className="p-2">{row.reportedRevenue == null ? "—" : formatIls(row.reportedRevenue)}</td>
      <td className="p-2">{row.computedUnitPrice == null ? "—" : formatIls(row.computedUnitPrice)}</td>
      <td className="p-2">{row.currentPrice == null ? "—" : formatIls(row.currentPrice)}</td>
      <td className="p-2">
        <input
          type="number"
          step="0.01"
          className="h-9 w-24 rounded-lg border px-2"
          value={row.proposedPrice ?? ""}
          onChange={(e) => onDecision(row.key, { proposedPrice: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <label className="mt-1 flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={row.updatePrice}
            onChange={(e) => onDecision(row.key, { updatePrice: e.target.checked })}
          />
          {t("admin.pos.updatePrice")}
        </label>
      </td>
      <td className="max-w-[16rem] whitespace-pre-wrap break-words p-2">
        <p>{row.stockPath === "recipe" ? t("admin.pos.stockRecipe") : t("admin.pos.stockFinished")}</p>
        <p className="text-xs text-coffee/70">{impact || "—"}</p>
        {row.impacts.some((item) => item.goesNegative) && <p className="text-xs text-amber-800">{t("admin.pos.goesNegative")}</p>}
        {row.overlap && <p className="text-xs text-amber-800">{t("admin.pos.overlapRow")}</p>}
      </td>
    </tr>
  );
}
