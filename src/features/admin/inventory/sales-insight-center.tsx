"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { suggestPeriodFromFileName } from "@/lib/inventory/pos-parse";
import { isValidSalesPeriod } from "@/lib/inventory/pos-excel";
import {
  adviseFromFacts,
  analyzeSalesLines,
  rankRecommendations,
  simulateDiscount,
  type SalesProductFact,
} from "@/lib/inventory/sales-analysis";
import type { PosApplyPlan } from "@/lib/inventory/pos-apply";
import type { PosSaleLine } from "@/lib/inventory/types";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";

type Tab = "overview" | "products" | "pricing" | "stock" | "balance";

export function SalesInsightCenter({
  fileName,
  lines,
  products,
  periodFrom,
  periodTo,
  periodNeedsReview,
  plan,
  onSavePeriod,
}: {
  fileName: string;
  lines: PosSaleLine[];
  products: Product[];
  periodFrom?: string | null;
  periodTo?: string | null;
  periodNeedsReview?: boolean;
  plan: PosApplyPlan;
  onSavePeriod: (from: string, to: string) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "gap" | "profit" | "missing">("all");
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [discount, setDiscount] = useState(10);
  const suggestion = suggestPeriodFromFileName(fileName);
  const recognized = isValidSalesPeriod(periodFrom, periodTo);
  const facts = useMemo(
    () =>
      analyzeSalesLines({
        lines,
        periodRecognized: recognized,
        verifiedCosts: products
          .filter((product) => product.costVerified === true && product.cost > 0)
          .map((product) => ({
            productId: product.id,
            unitCost: product.cost,
            basis: "manual" as const,
            listPrice: product.price,
          })),
      }),
    [lines, products, recognized]
  );
  const top = rankRecommendations(adviseFromFacts(facts));
  const margin =
    facts.verifiedGross != null && facts.verifiedRevenue != null && facts.verifiedRevenue > 0
      ? Math.round((facts.verifiedGross / facts.verifiedRevenue) * 1000) / 10
      : null;
  const recipeRows = plan.rows.filter((row) => row.eligible && row.stockPath === "recipe").length;
  const unitRows = plan.rows.filter((row) => row.eligible && row.stockPath === "finished-unit" && row.impacts.length > 0).length;

  const rows = facts.products.filter((row) => {
    if (query && !row.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "gap") return row.anomalies.includes("revenue_qty_mismatch") || row.anomalies.includes("profit_mismatch");
    if (filter === "profit") return (row.verifiedGross ?? 0) > 0;
    if (filter === "missing") return row.verifiedUnitCost == null;
    return true;
  });
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-dark-brown">{t("admin.insight.title")}</h2>
        <p className="mt-1 text-sm text-coffee/65">{t("admin.insight.subtitle")}</p>
      </div>

      {!recognized && (
        <PeriodPrompt
          suggestion={suggestion}
          onSave={onSavePeriod}
          needsReview={Boolean(periodNeedsReview)}
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label={t("admin.insight.revenue")} value={facts.reportedRevenue == null ? "—" : formatIls(facts.reportedRevenue)} />
        <Kpi label={t("admin.insight.quantity")} value={String(facts.quantity)} />
        <Kpi label={t("admin.insight.gross")} value={facts.verifiedGross == null ? "—" : formatIls(facts.verifiedGross)} hint={facts.verifiedGross == null ? t("admin.insight.grossMissing") : undefined} />
        <Kpi label={t("admin.insight.margin")} value={margin == null ? "—" : `${margin}%`} />
        <Kpi label={t("admin.insight.products")} value={String(facts.productCount)} />
        <Kpi label={t("admin.insight.exceptions")} value={String(facts.anomalyCount + plan.negativeCount)} />
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {(["overview", "products", "pricing", "stock", "balance"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => { setTab(item); setPage(0); }}
            className={cn("shrink-0 rounded-full px-3 py-1 text-sm", tab === item ? "bg-turquoise text-warm-white" : "bg-beige/70 text-coffee")}
          >
            {t(`admin.insight.tab.${item}`)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-3 lg:grid-cols-2">
          {top.length === 0 && <p className="text-sm text-coffee/60">{t("admin.insight.noAdvice")}</p>}
          {top.map((card, index) => (
            <article key={card.id} className="rounded-2xl border border-beige-dark/20 bg-warm-white p-3">
              <p className="text-xs text-turquoise">{index + 1}</p>
              <h3 className="font-semibold">{card.productName || t(`admin.insight.why.${card.why}`)}</h3>
              <p className="mt-1 text-sm text-coffee/70">{t(`admin.insight.why.${card.why}`)}</p>
              <p className="mt-2 text-xs text-coffee/50">{card.severity}</p>
            </article>
          ))}
        </div>
      )}

      {tab === "products" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={t("admin.insight.search")} className="max-w-xs" />
            {(["all", "gap", "profit", "missing"] as const).map((item) => (
              <Button key={item} type="button" variant={filter === item ? "turquoise" : "outline"} onClick={() => { setFilter(item); setPage(0); }}>
                {t(`admin.insight.filter.${item}`)}
              </Button>
            ))}
          </div>
          <div className="space-y-2 lg:hidden">
            {visible.map((row) => (
              <ProductCard key={row.key} row={row} open={openKey === row.key} onOpen={() => setOpenKey(openKey === row.key ? null : row.key)} />
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-2xl border border-beige-dark/20 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-beige/40 text-coffee/70">
                <tr>
                  <th className="px-3 py-2 text-start">{t("admin.insight.col.product")}</th>
                  <th className="px-3 py-2 text-end">{t("admin.insight.col.qty")}</th>
                  <th className="px-3 py-2 text-end">{t("admin.insight.col.revenue")}</th>
                  <th className="px-3 py-2 text-end">{t("admin.insight.col.average")}</th>
                  <th className="px-3 py-2 text-end">{t("admin.insight.col.cost")}</th>
                  <th className="px-3 py-2 text-end">{t("admin.insight.col.gross")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.key} className="cursor-pointer border-t border-beige-dark/10" onClick={() => setOpenKey(openKey === row.key ? null : row.key)}>
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2 text-end">{row.quantity}</td>
                    <td className="px-3 py-2 text-end">{row.reportedRevenue == null ? "—" : formatIls(row.reportedRevenue)}</td>
                    <td className="px-3 py-2 text-end">{row.averagePrice == null ? "—" : formatIls(row.averagePrice)}</td>
                    <td className="px-3 py-2 text-end">{row.verifiedUnitCost == null ? "—" : formatIls(row.verifiedUnitCost)}</td>
                    <td className="px-3 py-2 text-end">{row.verifiedGross == null ? "—" : formatIls(row.verifiedGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openKey && visible.some((row) => row.key === openKey) && (
            <ProductDetail row={visible.find((row) => row.key === openKey)!} products={products} />
          )}
          <div className="flex items-center justify-between text-sm">
            <Button type="button" variant="ghost" disabled={page <= 0} onClick={() => setPage((value) => value - 1)}>{t("admin.insight.prev")}</Button>
            <span>{page + 1} / {pageCount}</span>
            <Button type="button" variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>{t("admin.insight.next")}</Button>
          </div>
        </div>
      )}

      {tab === "pricing" && (
        <DiscountBox
          discount={discount}
          onDiscount={setDiscount}
          sample={facts.products.find((row) => row.verifiedUnitCost != null && row.averagePrice != null) ?? null}
        />
      )}

      {tab === "stock" && (
        <div className="space-y-2 rounded-2xl border border-beige-dark/20 bg-warm-white p-4 text-sm">
          <p>{t("admin.insight.stock.simulation")}</p>
          <p>{t("admin.insight.stock.negative")}: {plan.negativeCount}</p>
          <p>{t("admin.insight.stock.recipe")}: {recipeRows}</p>
          <p>{t("admin.insight.stock.unit")}: {unitRows}</p>
          <p>{t("admin.insight.stock.overlap")}: {plan.overlaps.length}</p>
          <p className="text-coffee/60">{t("admin.insight.stock.notApplied")}</p>
        </div>
      )}

      {tab === "balance" && (
        <p className="rounded-2xl border border-beige-dark/20 bg-warm-white p-4 text-sm text-coffee/70">
          {t("admin.insight.balanceMissing")}
        </p>
      )}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-beige-dark/15 bg-warm-white px-3 py-3">
      <p className="text-xs text-coffee/55">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-dark-brown">{value}</p>
      {hint && <p className="mt-1 text-xs text-coffee/50">{hint}</p>}
    </div>
  );
}

function PeriodPrompt({
  suggestion,
  onSave,
  needsReview,
}: {
  suggestion: { from: string; to: string } | null;
  onSave: (from: string, to: string) => void;
  needsReview: boolean;
}) {
  const t = useT();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const valid = isValidSalesPeriod(from, to);
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-semibold text-amber-950">{t("admin.insight.periodQuestion")}</p>
      <p className="mt-1 text-sm text-amber-900">{needsReview ? t("admin.pos.dateUnrecognized") : t("admin.insight.periodHint")}</p>
      {suggestion && (
        <button type="button" className="mt-2 text-sm text-turquoise underline" onClick={() => { setFrom(suggestion.from); setTo(suggestion.to); }}>
          {t("admin.insight.fileSuggestion")}: {suggestion.from} – {suggestion.to}
        </button>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <Button className="mt-3" type="button" variant="outline" disabled={!valid} onClick={() => onSave(from, to)}>
        {t("admin.pos.savePeriodContinue")}
      </Button>
    </div>
  );
}

function ProductCard({ row, open, onOpen }: { row: SalesProductFact; open: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-beige-dark/15 p-3 text-start">
      <p className="font-semibold">{row.name}</p>
      <p className="text-sm text-coffee/65">{row.quantity} · {row.reportedRevenue == null ? "—" : formatIls(row.reportedRevenue)}</p>
      {open && <p className="mt-1 text-xs text-coffee/55">{row.averagePrice == null ? "—" : formatIls(row.averagePrice)}</p>}
    </button>
  );
}

function ProductDetail({ row, products }: { row: SalesProductFact; products: Product[] }) {
  const t = useT();
  const menu = products.find((product) => product.id === row.menuProductId);
  const gap = menu && row.averagePrice != null ? Math.round((row.averagePrice - menu.price) * 100) / 100 : null;
  return (
    <div className="rounded-2xl bg-beige/40 px-3 py-2 text-sm">
      <p>{t("admin.insight.menuPrice")}: {menu ? formatIls(menu.price) : "—"}</p>
      <p>{t("admin.insight.averagePrice")}: {row.averagePrice == null ? "—" : formatIls(row.averagePrice)}</p>
      {gap != null && Math.abs(gap) > 0.05 && <p>{t("admin.insight.priceGap")}: {formatIls(gap)}</p>}
      {Math.abs(gap ?? 0) <= 0.05 && menu && <p>{t("admin.insight.priceMatches")}</p>}
      <p className="text-coffee/60">{t("admin.insight.priceNotUpdated")}</p>
    </div>
  );
}

function DiscountBox({
  discount,
  onDiscount,
  sample,
}: {
  discount: number;
  onDiscount: (value: number) => void;
  sample: SalesProductFact | null;
}) {
  const t = useT();
  if (!sample || sample.averagePrice == null) {
    return <p className="text-sm text-coffee/60">{t("admin.insight.discountNeedCost")}</p>;
  }
  const result = simulateDiscount({
    currentPrice: sample.averagePrice,
    discountPercent: discount,
    quantity: sample.quantity,
    verifiedUnitCost: sample.verifiedUnitCost,
  });
  return (
    <div className="rounded-2xl border border-beige-dark/20 bg-warm-white p-4 text-sm">
      <p className="font-semibold">{sample.name}</p>
      <div className="mt-2 flex gap-2">
        {[5, 10, 20].map((value) => (
          <Button key={value} type="button" variant={discount === value ? "turquoise" : "outline"} onClick={() => onDiscount(value)}>{value}%</Button>
        ))}
      </div>
      <p className="mt-3">{t("admin.insight.discountPrice")}: {formatIls(result.discountedPrice)}</p>
      <p>{t("admin.insight.discountProfit")}: {result.unitProfitAfter == null ? "—" : formatIls(result.unitProfitAfter)}</p>
      <p>{t("admin.insight.discountQty")}: {result.quantityToHoldProfit ?? "—"}</p>
      {result.losesMoney && <p className="mt-2 text-red-700">{t("admin.insight.discountLoss")}</p>}
      <p className="mt-2 text-xs text-coffee/55">{t("admin.salesAi.simulationNote")}</p>
    </div>
  );
}
