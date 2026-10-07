import React, { type CSSProperties, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import type { InventoryStatus } from "@/lib/reports/types";
import type { ReportCopy } from "@/lib/reports/pdf/copy";

export const REPORT_INK = {
  brown: "#3D2B24",
  teal: "#007A80",
  cream: "#F8F3ED",
  white: "#FFFFFF",
  line: "#D4C4B4",
  muted: "#6B5348",
  ink: "#2A1C17",
  low: "#9A5B12",
  out: "#9B1C1C",
  ok: "#0F5C56",
  gray: "#4B5563",
} as const;

const STATUS_COLOR: Record<InventoryStatus, string> = {
  ok: REPORT_INK.ok,
  low: REPORT_INK.low,
  out: REPORT_INK.out,
  "no-supplier": REPORT_INK.gray,
  "needs-attention": REPORT_INK.low,
};

export function ReportDocument({
  orientation,
  children,
}: {
  orientation: "portrait" | "landscape";
  children: ReactNode;
}) {
  const width = orientation === "landscape" ? 297 : 210;
  const height = orientation === "landscape" ? 210 : 297;
  return (
    <div
      className="report-a4-page"
      data-report-page="true"
      style={{
        width: `${width}mm`,
        height: `${height}mm`,
        minWidth: `${width}mm`,
        minHeight: `${height}mm`,
        maxWidth: `${width}mm`,
        maxHeight: `${height}mm`,
        background: REPORT_INK.white,
        color: REPORT_INK.ink,
        direction: "rtl",
        boxSizing: "border-box",
        padding: "13mm 14mm 11mm",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: 'var(--font-heebo), var(--font-cairo), "Segoe UI", Tahoma, sans-serif',
      }}
    >
      {children}
    </div>
  );
}

export function ReportHeader({ copy }: { copy: ReportCopy }) {
  return (
    <header style={{ borderBottom: `1.5px solid ${REPORT_INK.brown}`, paddingBottom: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" style={{ height: 36, width: "auto" }} />
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.6, color: REPORT_INK.brown }}>
              {copy.brandEn}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: REPORT_INK.teal }}>{copy.brandAr}</p>
            <h1 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 700, color: REPORT_INK.brown }}>
              {copy.title}
            </h1>
          </div>
        </div>
        <div style={{ textAlign: "left", fontSize: 10, color: REPORT_INK.muted, lineHeight: 1.55, minWidth: 120 }}>
          <p style={{ margin: 0 }}>{copy.generatedLabel}: <Num>{copy.generatedAt}</Num></p>
          <p style={{ margin: 0 }}>{copy.col.formTime}: <Num>{copy.generatedTime}</Num></p>
          <p style={{ margin: 0 }}>{copy.periodLabel}: <Num>{copy.periodValue}</Num></p>
          <p style={{ margin: 0 }}>{copy.branchLabel}: {copy.branchValue}</p>
        </div>
      </div>
    </header>
  );
}

export function ReportFiltersSummary({ copy }: { copy: ReportCopy }) {
  if (!copy.filters.length) return null;
  return (
    <div style={{ fontSize: 10, color: REPORT_INK.muted, marginBottom: 8, lineHeight: 1.45 }}>
      {copy.filters.map((item) => (
        <span key={`${item.label}-${item.value}`} style={{ marginInlineEnd: 12 }}>
          {item.label}: <strong style={{ color: REPORT_INK.ink }}>{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

export function ReportSummary({ copy }: { copy: ReportCopy }) {
  if (!copy.kpis.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(copy.kpis.length, 6)}, minmax(0, 1fr))`,
        gap: 6,
        marginBottom: 10,
      }}
    >
      {copy.kpis.map((kpi) => (
        <div
          key={kpi.label}
          style={{
            border: `1px solid ${REPORT_INK.line}`,
            borderTop: `3px solid ${REPORT_INK.teal}`,
            padding: "6px 7px",
            background: REPORT_INK.white,
          }}
        >
          <p style={{ margin: 0, fontSize: 8.5, color: REPORT_INK.muted, lineHeight: 1.3 }}>{kpi.label}</p>
          <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 700, color: REPORT_INK.brown }}>
            <Num>{kpi.value}</Num>
          </p>
        </div>
      ))}
    </div>
  );
}

export function ReportSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 8 }}>
      {title ? (
        <h2 style={{ margin: "0 0 6px", fontSize: 12, color: REPORT_INK.teal, fontWeight: 700 }}>{title}</h2>
      ) : null}
      {children}
    </section>
  );
}

export function ReportTable({
  headers,
  children,
  writeRows,
}: {
  headers: string[];
  children: ReactNode;
  writeRows?: boolean;
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: writeRows ? 10 : 8.5,
        tableLayout: "fixed",
      }}
    >
      <thead>
        <tr>
          {headers.map((header) => (
            <th
              key={header}
              style={{
                background: REPORT_INK.brown,
                color: REPORT_INK.white,
                fontWeight: 600,
                padding: writeRows ? "6px 4px" : "4px 3px",
                textAlign: "right",
                border: `1px solid ${REPORT_INK.brown}`,
              }}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function ReportTd({
  children,
  num,
  write,
  span,
}: {
  children?: ReactNode;
  num?: boolean;
  write?: boolean;
  span?: number;
}) {
  return (
    <td
      colSpan={span}
      style={{
        border: `1px solid ${REPORT_INK.line}`,
        padding: write ? "10px 4px" : "3px 3px",
        height: write ? 22 : undefined,
        verticalAlign: "middle",
        textAlign: num ? "left" : "right",
        direction: num ? "ltr" : undefined,
        color: REPORT_INK.ink,
        overflow: "hidden",
      }}
    >
      {num ? <Num>{children}</Num> : children}
    </td>
  );
}

export function StatusBadge({ status, label }: { status: InventoryStatus | string; label: string }) {
  const color = STATUS_COLOR[status as InventoryStatus] ?? REPORT_INK.gray;
  return (
    <span
      style={{
        display: "inline-block",
        border: `1px solid ${color}`,
        color,
        fontSize: 8,
        fontWeight: 700,
        padding: "1px 5px",
        borderRadius: 3,
        lineHeight: 1.4,
        background: REPORT_INK.white,
      }}
    >
      {label}
    </span>
  );
}

export function ReportFooter({ copy, page, total }: { copy: ReportCopy; page: number; total: number }) {
  return (
    <footer
      style={{
        marginTop: "auto",
        borderTop: `1px solid ${REPORT_INK.line}`,
        paddingTop: 6,
        display: "flex",
        justifyContent: "space-between",
        fontSize: 9,
        color: REPORT_INK.muted,
      }}
    >
      <span>Mishkat Cafe · {copy.title}</span>
      <ReportPageNumber copy={copy} page={page} total={total} />
    </footer>
  );
}

export function ReportPageNumber({ copy, page, total }: { copy: ReportCopy; page: number; total: number }) {
  return <span style={{ direction: "ltr" }}>{copy.pageOf(page, total)}</span>;
}

export function Num({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span dir="ltr" style={{ unicodeBidi: "isolate", ...style }}>
      {children}
    </span>
  );
}

export function BlankLine({ label }: { label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 6, minWidth: 140 }}>
      <span>{label}:</span>
      <span style={{ flex: 1, borderBottom: `1px solid ${REPORT_INK.ink}`, minWidth: 90, height: 14 }} />
    </span>
  );
}
