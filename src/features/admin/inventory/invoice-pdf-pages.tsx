import React from "react";
import { BRAND } from "@/lib/brand";
import {
  INVOICE_DOCUMENT_TITLE,
  type InvoiceDocument,
  type InvoicePageBlock,
} from "@/lib/inventory/invoice-document";
import { REPORT_INK } from "@/features/admin/reports/pdf/report-shell";

const FONT = 'var(--font-heebo), var(--font-cairo), "Segoe UI", Tahoma, sans-serif';

export function InvoicePdfPages({
  doc,
  pages,
  pageNumber,
  pageCount,
}: {
  doc: InvoiceDocument;
  pages: InvoicePageBlock[][];
  pageNumber?: number;
  pageCount?: number;
}) {
  return (
    <>
      {pages.map((blocks, index) => (
        <article
          key={index}
          data-invoice-page="true"
          style={{
            width: "210mm",
            height: "297mm",
            background: REPORT_INK.white,
            color: REPORT_INK.ink,
            direction: "rtl",
            boxSizing: "border-box",
            padding: "12mm 12mm 10mm",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: FONT,
          }}
        >
          {blocks.map((block, blockIndex) => (
            <BlockView key={`${block.kind}-${blockIndex}`} block={block} doc={doc} />
          ))}
          <footer style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${REPORT_INK.line}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: REPORT_INK.muted }}>
            <span>{doc.systemMark}</span>
            <span>{pageNumber ?? index + 1} / {pageCount ?? pages.length}</span>
          </footer>
        </article>
      ))}
    </>
  );
}

function BlockView({ block, doc }: { block: InvoicePageBlock; doc: InvoiceDocument }) {
  if (block.kind === "banner") return <Banner doc={doc} />;
  if (block.kind === "header") return <Header doc={doc} />;
  if (block.kind === "lines") return <Lines rows={block.rows} />;
  if (block.kind === "money") return <Money doc={doc} />;
  if (block.kind === "stock") return <Stock doc={doc} />;
  if (block.kind === "timeline") return <Timeline doc={doc} />;
  return <Notes doc={doc} />;
}

function Banner({ doc }: { doc: InvoiceDocument }) {
  return (
    <div style={{ background: "#F4E7D4", color: REPORT_INK.brown, borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
      {doc.systemMark}
    </div>
  );
}

function Header({ doc }: { doc: InvoiceDocument }) {
  return (
    <section style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderBottom: `1.5px solid ${REPORT_INK.brown}`, paddingBottom: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" style={{ height: 42, width: "auto" }} />
          <div>
            <p style={{ margin: 0, fontSize: 12, color: REPORT_INK.teal, fontWeight: 700 }}>MISHKAT</p>
            <h1 style={{ margin: "2px 0 0", fontSize: 18, color: REPORT_INK.brown }}>{INVOICE_DOCUMENT_TITLE}</h1>
          </div>
        </div>
      </div>
      <h2 style={sectionTitle}>חלק א׳ — פרטי החשבונית</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
        {doc.header.map((field) => (
          <p key={field.label} style={{ margin: 0, fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>
            <span style={{ color: REPORT_INK.muted }}>{field.label}: </span>
            <strong>{field.value}</strong>
          </p>
        ))}
      </div>
    </section>
  );
}

function Lines({ rows }: { rows: InvoiceDocument["lines"] }) {
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 style={sectionTitle}>חלק ב׳ — טבלת מוצרים</h2>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12 }}>אין שורות שמורות בחשבונית.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr>
              {["#", "מוצר", "קטגוריה", "כמות", "יחידה", "מחיר", "הנחה", "מע״מ", "סה״כ", "שיוך", "קליטה"].map((label) => (
                <th key={label} style={th}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.position}>
                <td style={td}>{row.position}</td>
                <td style={{ ...td, overflowWrap: "anywhere", whiteSpace: "normal", minWidth: 80 }}>{row.name}</td>
                <td style={{ ...td, overflowWrap: "anywhere" }}>{row.category}</td>
                <td style={td}>{row.quantity}</td>
                <td style={td}>{row.unit}</td>
                <td style={td}>{row.unitPrice}</td>
                <td style={td}>{row.discount}</td>
                <td style={{ ...td, overflowWrap: "anywhere" }}>{row.vat}</td>
                <td style={td}>{row.total}</td>
                <td style={{ ...td, overflowWrap: "anywhere" }}>{row.product}</td>
                <td style={td}>{row.receipt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Money({ doc }: { doc: InvoiceDocument }) {
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 style={sectionTitle}>חלק ג׳ — סיכום כספי</h2>
      {doc.money.map((row) => (
        <p key={row.label} style={fact}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </p>
      ))}
      {doc.mismatchNote ? (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9B1C1C", overflowWrap: "anywhere" }}>{doc.mismatchNote}</p>
      ) : (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: REPORT_INK.ok }}>הסכומים השמורים תואמים לסיכום השורות.</p>
      )}
    </section>
  );
}

function Stock({ doc }: { doc: InvoiceDocument }) {
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 style={sectionTitle}>חלק ד׳ — תיעוד קליטה למלאי</h2>
      {doc.stock.emptyLabel ? <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{doc.stock.emptyLabel}</p> : null}
      {doc.stock.facts.map((row) => (
        <p key={row.label} style={fact}><span>{row.label}</span><strong>{row.value}</strong></p>
      ))}
      {doc.stock.movements.map((row, index) => (
        <p key={`${row.label}-${index}`} style={{ ...fact, overflowWrap: "anywhere" }}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </p>
      ))}
      {doc.stock.issues.map((issue) => (
        <p key={issue} style={{ margin: "4px 0 0", fontSize: 11, color: "#9A5B12", overflowWrap: "anywhere" }}>{issue}</p>
      ))}
    </section>
  );
}

function Timeline({ doc }: { doc: InvoiceDocument }) {
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 style={sectionTitle}>חלק ה׳ — היסטוריית פעולות</h2>
      {doc.timeline.length === 0 ? <p style={{ margin: 0, fontSize: 12 }}>אין אירועים שמורים.</p> : null}
      {doc.timeline.map((event, index) => (
        <p key={`${event.at}-${event.action}-${index}`} style={{ margin: "0 0 4px", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>
          <strong>{event.action}</strong>
          {" · "}
          {event.at}
          {" · "}
          {event.actor}
          {event.detail ? ` · ${event.detail}` : ""}
          {event.before || event.after ? ` · ${event.before || "—"} ← ${event.after || "—"}` : ""}
        </p>
      ))}
    </section>
  );
}

function Notes({ doc }: { doc: InvoiceDocument }) {
  return (
    <section>
      <h2 style={sectionTitle}>חלק ו׳ — קובץ המקור</h2>
      <p style={{ margin: "0 0 8px", fontSize: 11, overflowWrap: "anywhere" }}>{doc.source.note}</p>
      <h2 style={sectionTitle}>חלק ז׳ — הערות</h2>
      {doc.notes.map((note) => (
        <p key={note} style={{ margin: "0 0 4px", fontSize: 11, overflowWrap: "anywhere" }}>{note}</p>
      ))}
    </section>
  );
}

const sectionTitle: React.CSSProperties = {
  margin: "8px 0 4px",
  fontSize: 13,
  color: REPORT_INK.teal,
};

const th: React.CSSProperties = {
  textAlign: "right",
  fontWeight: 700,
  padding: "4px 3px",
  borderBottom: `1px solid ${REPORT_INK.line}`,
  color: REPORT_INK.brown,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  textAlign: "right",
  padding: "4px 3px",
  borderBottom: `1px solid ${REPORT_INK.cream}`,
  verticalAlign: "top",
  lineHeight: 1.35,
  whiteSpace: "normal",
};

const fact: React.CSSProperties = {
  margin: 0,
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 11,
  lineHeight: 1.5,
};
