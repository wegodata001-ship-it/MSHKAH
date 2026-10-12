import React from "react";
import { formatReportDate, formatReportIls, formatReportQty } from "@/lib/reports/format";
import type { ReportCopy } from "@/lib/reports/pdf/copy";
import type { ReportBlock, ReportDocPage } from "@/lib/reports/pdf/paginate";
import type {
  CountTotals,
  InventoryReportRow,
  PurchaseSupplierGroup,
  ReportPayload,
  SupplierPriceCompare,
} from "@/lib/reports/types";
import {
  BlankLine,
  Num,
  REPORT_INK,
  ReportDocument,
  ReportFiltersSummary,
  ReportFooter,
  ReportHeader,
  ReportSection,
  ReportSummary,
  ReportTable,
  ReportTd,
  StatusBadge,
} from "@/features/admin/reports/pdf/report-shell";

export function ReportA4Pages({
  pages,
  payload,
  copy,
}: {
  pages: ReportDocPage[];
  payload: ReportPayload;
  copy: ReportCopy;
}) {
  return (
    <>
      {pages.map((page) => (
        <ReportDocument key={page.index} orientation={page.orientation}>
          <ReportHeader copy={copy} />
          {page.showFormMeta ? <CountFormMeta copy={copy} /> : null}
          {page.showKpis ? (
            <>
              <ReportFiltersSummary copy={copy} />
              <ReportSummary copy={copy} />
            </>
          ) : (
            <ReportFiltersSummary copy={copy} />
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            {page.blocks.map((block, index) => (
              <ReportBlockView key={`${page.index}-${block.kind}-${index}`} block={block} copy={copy} payload={payload} />
            ))}
          </div>
          {page.showFormFooter ? <CountFormFooter copy={copy} /> : null}
          <ReportFooter copy={copy} page={page.index + 1} total={page.total} />
        </ReportDocument>
      ))}
    </>
  );
}

function ReportBlockView({
  block,
  copy,
  payload,
}: {
  block: ReportBlock;
  copy: ReportCopy;
  payload: ReportPayload;
}) {
  if (block.kind === "inventory") {
    return (
      <ReportSection>
        {block.rows.map((row) => (
          <InventoryCard key={row.productId} row={row} copy={copy} />
        ))}
      </ReportSection>
    );
  }
  if (block.kind === "exceptions") {
    return (
      <ReportTable
        headers={[
          copy.col.product,
          copy.col.issue,
          copy.col.current,
          copy.col.min,
          copy.col.toOrder,
          copy.col.lastSupplier,
          copy.col.lastPrice,
          copy.col.action,
        ]}
      >
        {block.rows.map((row) => (
          <tr key={`${row.productId}-${row.kind}`}>
            <ReportTd>{row.name}</ReportTd>
            <ReportTd>
              <StatusBadge status={row.kind === "out" ? "out" : row.kind === "below-min" ? "low" : row.kind === "no-supplier" ? "no-supplier" : "needs-attention"} label={copy.exception[row.kind]} />
            </ReportTd>
            <ReportTd num>{formatReportQty(row.current)}</ReportTd>
            <ReportTd num>{formatReportQty(row.minStock)}</ReportTd>
            <ReportTd num>{formatReportQty(row.toOrder)}</ReportTd>
            <ReportTd>{row.supplier ?? "—"}</ReportTd>
            <ReportTd num>{formatReportIls(row.lastPrice, 4)}</ReportTd>
            <ReportTd>{copy.action[row.action] ?? row.action}</ReportTd>
          </tr>
        ))}
      </ReportTable>
    );
  }
  if (block.kind === "blank") {
    return (
      <ReportTable
        writeRows
        headers={[
          copy.col.hash,
          copy.col.product,
          copy.col.category,
          copy.col.unit,
          copy.col.systemQty,
          copy.col.actualQty,
          copy.col.gap,
          copy.col.notes,
        ]}
      >
        {block.rows.map((row, index) => (
          <tr key={row.productId} style={{ height: 28 }}>
            <ReportTd write num>{block.startIndex + index + 1}</ReportTd>
            <ReportTd write>{row.name}</ReportTd>
            <ReportTd write>{row.category}</ReportTd>
            <ReportTd write>{row.unit}</ReportTd>
            <ReportTd write num>{formatReportQty(row.systemQty)}</ReportTd>
            <ReportTd write />
            <ReportTd write />
            <ReportTd write />
          </tr>
        ))}
      </ReportTable>
    );
  }
  if (block.kind === "counts") {
    return (
      <ReportTable
        headers={[
          copy.col.product,
          copy.col.opening,
          copy.col.purchases,
          copy.col.otherIn,
          copy.col.sales,
          copy.col.expected,
          copy.col.actual,
          copy.col.gap,
          copy.col.gapCost,
          copy.col.status,
        ]}
      >
        {block.rows.map((row) => (
          <tr key={row.productId}>
            <ReportTd>{row.name}</ReportTd>
            <ReportTd num>{formatReportQty(row.opening)}</ReportTd>
            <ReportTd num>{formatReportQty(row.incoming)}</ReportTd>
            <ReportTd num>{formatReportQty(row.otherIn)}</ReportTd>
            <ReportTd num>{formatReportQty(row.sales)}</ReportTd>
            <ReportTd num>{formatReportQty(row.expected)}</ReportTd>
            <ReportTd num>{formatReportQty(row.actual)}</ReportTd>
            <ReportTd num>{formatReportQty(row.gap)}</ReportTd>
            <ReportTd num>{formatReportIls(row.gapCost)}</ReportTd>
            <ReportTd>
              <StatusBadge
                status={row.tone === "ok" ? "ok" : row.tone === "watch" ? "low" : row.tone === "critical" ? "out" : "no-supplier"}
                label={row.tone === "none" ? "—" : copy.status[row.tone === "ok" ? "ok" : row.tone === "watch" ? "low" : "needs-attention"]}
              />
            </ReportTd>
          </tr>
        ))}
      </ReportTable>
    );
  }
  if (block.kind === "count-totals") {
    return <CountTotalsBox totals={payload.countTotals} copy={copy} />;
  }
  if (block.kind === "purchase-group") {
    return <PurchaseGroupView group={block.group} rows={block.rows} showHeader={block.showHeader} showFooter={block.showFooter} copy={copy} />;
  }
  if (block.kind === "breakeven") {
    return <BreakEvenReportView payload={payload} copy={copy} />;
  }
  return (
    <ReportSection>
      {block.items.map((item) => (
        <CompareCard key={item.productId} item={item} copy={copy} />
      ))}
    </ReportSection>
  );
}

function BreakEvenReportView({ payload, copy }: { payload: ReportPayload; copy: ReportCopy }) {
  const data = payload.breakEven;
  if (!data) return null;
  const rows: [string, string][] = [
    [copy.col.beSales, formatReportIls(data.revenue)],
    [copy.col.beFixed, formatReportIls(data.fixedMonthly)],
    [copy.col.beVariable, formatReportIls(data.variableTotal)],
    [copy.col.beFood, formatReportIls(data.foodCost)],
    [copy.col.beContribution, formatReportIls(data.contribution)],
    [copy.col.beBreakEven, formatReportIls(data.breakEvenMonthly)],
    [copy.col.beGap, formatReportIls(data.gap)],
    [copy.col.beForecast, formatReportIls(data.forecast)],
    [copy.col.beOrders, data.orders == null ? "—" : String(data.orders)],
    [copy.col.beAov, formatReportIls(data.averageOrderValue)],
  ];
  return (
    <ReportSection>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ border: `1px solid ${REPORT_INK.line}`, padding: 8 }}>
            <div style={{ fontSize: 9, color: REPORT_INK.muted }}>{label}</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}><Num>{value}</Num></div>
          </div>
        ))}
      </div>
    </ReportSection>
  );
}

function InventoryCard({ row, copy }: { row: InventoryReportRow; copy: ReportCopy }) {
  const fields = [
    [copy.col.category, row.category],
    [copy.col.unit, row.unit],
    [copy.col.opening, formatReportQty(row.opening)],
    [copy.col.incoming, formatReportQty(row.incoming)],
    [copy.col.consumption, formatReportQty(row.consumption)],
    [copy.col.current, formatReportQty(row.current)],
    [copy.col.min, formatReportQty(row.minStock)],
    [copy.col.toOrder, formatReportQty(row.toOrder)],
    [copy.col.lastSupplier, row.lastSupplier ?? "—"],
    [copy.col.lastPrice, formatReportIls(row.lastPrice, 4)],
    [copy.col.normalized, formatReportIls(row.normalizedPrice, 4)],
    [copy.col.stockValue, formatReportIls(row.stockValue)],
  ];
  return (
    <div
      style={{
        border: `1px solid ${REPORT_INK.line}`,
        marginBottom: 7,
        padding: "6px 8px 7px",
        breakInside: "avoid",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <strong style={{ fontSize: 12, color: REPORT_INK.brown }}>{row.name}</strong>
        <StatusBadge status={row.status} label={copy.status[row.status]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "3px 8px", fontSize: 8.5 }}>
        {fields.map(([label, value], index) => (
          <div key={label}>
            <span style={{ color: REPORT_INK.muted }}>{label}: </span>
            {index < 2 || label === copy.col.lastSupplier ? value : <Num>{value}</Num>}
          </div>
        ))}
      </div>
      {row.supplierLines.length > 0 ? (
        <div style={{ marginTop: 5, fontSize: 8.5, color: REPORT_INK.ink }}>
          <div style={{ color: REPORT_INK.teal, fontWeight: 700, marginBottom: 2 }}>{copy.col.suppliers}</div>
          {row.supplierLines.map((line) => (
            <div key={line.supplierId}>
              • {line.supplierName} — <Num>{formatReportIls(line.price, 4)}</Num>
              {line.lastPurchaseDate ? (
                <>
                  {" "}
                  — {copy.col.date} <Num>{formatReportDate(line.lastPurchaseDate)}</Num>
                </>
              ) : null}
            </div>
          ))}
          {row.supplierLines.some((line) => line.cheapest) ? (
            <div style={{ marginTop: 2, fontWeight: 700 }}>
              {copy.col.cheapest}: {row.supplierLines.find((line) => line.cheapest)?.supplierName} —{" "}
              <Num>{formatReportIls(row.supplierLines.find((line) => line.cheapest)?.price ?? null, 4)}</Num>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PurchaseGroupView({
  group,
  rows,
  showHeader,
  showFooter,
  copy,
}: {
  group: PurchaseSupplierGroup;
  rows: PurchaseSupplierGroup["rows"];
  showHeader: boolean;
  showFooter: boolean;
  copy: ReportCopy;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      {showHeader ? (
        <div
          style={{
            background: REPORT_INK.cream,
            border: `1px solid ${REPORT_INK.line}`,
            padding: "6px 8px",
            marginBottom: 4,
            fontSize: 9,
          }}
        >
          <strong style={{ fontSize: 12, color: REPORT_INK.brown }}>{group.supplierName}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 4, marginTop: 4 }}>
            <span>{copy.col.phone}: <Num>{group.phone || "—"}</Num></span>
            <span>{copy.col.taxId}: <Num>{group.taxId || "—"}</Num></span>
            <span>{copy.col.invoiceCount}: <Num>{group.invoiceCount}</Num></span>
            <span>{copy.col.beforeVat}: <Num>{formatReportIls(group.totalBefore)}</Num></span>
            <span>{copy.col.vat}: <Num>{formatReportIls(group.totalVat)}</Num></span>
            <span>{copy.col.includingVat}: <Num>{formatReportIls(group.totalIncluding)}</Num></span>
          </div>
        </div>
      ) : null}
      <ReportTable
        headers={[
          copy.col.date,
          copy.col.invoice,
          copy.col.product,
          copy.col.qty,
          copy.col.unit,
          copy.col.netUnit,
          copy.col.vat,
          copy.col.grossUnit,
          copy.col.total,
        ]}
      >
        {rows.map((row, index) => (
          <tr key={`${row.invoice}-${row.product}-${index}`}>
            <ReportTd num>{formatReportDate(row.date)}</ReportTd>
            <ReportTd>{row.invoice}</ReportTd>
            <ReportTd>{row.product}</ReportTd>
            <ReportTd num>{formatReportQty(row.quantity)}</ReportTd>
            <ReportTd>{row.unit}</ReportTd>
            <ReportTd num>{formatReportIls(row.netUnitPrice)}</ReportTd>
            <ReportTd num>{formatReportIls(row.vatUnit)}</ReportTd>
            <ReportTd num>{formatReportIls(row.grossUnitPrice)}</ReportTd>
            <ReportTd num>{formatReportIls(row.includingVat)}</ReportTd>
          </tr>
        ))}
      </ReportTable>
      {showFooter ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, fontSize: 10, marginTop: 4, fontWeight: 700 }}>
          <span>{copy.col.subtotal}: <Num>{formatReportIls(group.totalBefore)}</Num></span>
          <span>{copy.col.vat}: <Num>{formatReportIls(group.totalVat)}</Num></span>
          <span>{copy.col.total}: <Num>{formatReportIls(group.totalIncluding)}</Num></span>
        </div>
      ) : null}
    </div>
  );
}

function CompareCard({ item, copy }: { item: SupplierPriceCompare; copy: ReportCopy }) {
  const best = item.offers.find((offer) => offer.supplierId === item.cheapestSupplierId);
  return (
    <div style={{ border: `1px solid ${REPORT_INK.line}`, padding: "7px 8px", marginBottom: 8, breakInside: "avoid" }}>
      <strong style={{ fontSize: 13, color: REPORT_INK.brown }}>{item.name}</strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 6 }}>
        {item.offers.map((offer) => (
          <div key={offer.supplierId} style={{ border: `1px solid ${REPORT_INK.line}`, padding: 6, fontSize: 9 }}>
            <div style={{ fontWeight: 700, color: REPORT_INK.teal }}>{offer.supplierName}</div>
            <div>{copy.col.pack}: <Num>{offer.packageQty ?? "—"}{offer.unit ? ` ${offer.unit}` : ""}</Num></div>
            <div>{copy.col.price}: <Num>{formatReportIls(offer.price)}</Num></div>
            <div>{copy.col.normalized}: <Num>{formatReportIls(offer.unitCost, 4)}</Num></div>
          </div>
        ))}
      </div>
      {best ? (
        <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, color: REPORT_INK.brown }}>
          {copy.col.bestOffer}: {best.supplierName}
          {item.savings != null ? (
            <>
              {" · "}
              {copy.col.savings}: <Num>{formatReportIls(item.savings, 4)}</Num>
              {item.savingsPct != null ? <Num>{` / ${item.savingsPct.toFixed(0)}%`}</Num> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CountTotalsBox({ totals, copy }: { totals?: CountTotals; copy: ReportCopy }) {
  if (!totals) return null;
  return (
    <div
      style={{
        marginTop: 8,
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 6,
      }}
    >
      {[
        [copy.col.consumptionTotal, formatReportQty(totals.consumption)],
        [copy.col.gapPositive, formatReportQty(totals.gapPositive)],
        [copy.col.gapNegative, formatReportQty(totals.gapNegative)],
        [copy.col.gapValue, formatReportIls(totals.gapValue)],
      ].map(([label, value]) => (
        <div key={label} style={{ border: `1px solid ${REPORT_INK.line}`, padding: 6 }}>
          <div style={{ fontSize: 8, color: REPORT_INK.muted }}>{label}</div>
          <div style={{ fontWeight: 700 }}><Num>{value}</Num></div>
        </div>
      ))}
    </div>
  );
}

function CountFormMeta({ copy }: { copy: ReportCopy }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11, marginBottom: 10 }}>
      <BlankLine label={copy.col.formDate} />
      <BlankLine label={copy.col.formTime} />
      <BlankLine label={copy.col.formWorker} />
      <BlankLine label={copy.col.formSign} />
    </div>
  );
}

function CountFormFooter({ copy }: { copy: ReportCopy }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 11, marginBottom: 8 }}>
      <div>
        <BlankLine label={copy.col.counterName} />
        <div style={{ height: 8 }} />
        <BlankLine label={copy.col.formSign} />
      </div>
      <div>
        <BlankLine label={copy.col.approverName} />
        <div style={{ height: 8 }} />
        <BlankLine label={copy.col.formSign} />
      </div>
    </div>
  );
}
