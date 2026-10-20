"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminCard } from "@/features/admin/components/admin-card";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { formatIls } from "@/lib/costing/money";
import { cn } from "@/lib/utils";

type Impact = {
  unitProfitBefore: number | null;
  unitProfitAfter: number | null;
  periodProfitBefore: number | null;
  periodProfitAfter: number | null;
  assumedQuantity: number;
  demandDropPercent: number;
};

type Recommendation = {
  id: string;
  productName: string;
  kind: string;
  severity: "high" | "medium" | "low";
  currentPrice: number | null;
  proposedPrice: number | null;
  why: string;
  evidence: string[];
  caveats: string[];
  narrative?: string | null;
  impact?: Impact | null;
  feedback?: "approved" | "rejected" | null;
};

type Report = {
  id: string;
  source: "ai" | "rules";
  periodFrom?: string | null;
  periodTo?: string | null;
  summary: {
    productCount: number;
    quantity: number;
    reportedRevenue: number | null;
    verifiedGross: number | null;
    missingCostCount: number;
    recommendationCount: number;
  };
  recommendations: Recommendation[];
};

const TABS = ["overview", "pricing", "profit", "winners", "care", "stock", "history"] as const;
type Tab = (typeof TABS)[number];

function tabKind(tab: Tab): string[] | null {
  if (tab === "pricing") return ["price", "high_volume_low_margin"];
  if (tab === "profit") return ["cost", "high_volume_low_margin"];
  if (tab === "winners") return ["winner"];
  if (tab === "care") return ["low_demand", "data"];
  if (tab === "stock") return ["inventory"];
  return null;
}

export function SalesAiPanel({ importId, autoAnalyze = false }: { importId: string; autoAnalyze?: boolean }) {
  const t = useT();
  const [report, setReport] = useState<Report | null>(null);
  const autoRan = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drop, setDrop] = useState(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  async function analyze(force = false) {
    setBusy(true);
    setError(null);
    const result = await clientAdminFetch<{ report: Report }>("/api/admin/pos/sales-ai", {
      action: "analyze",
      importId,
      force,
      demandDropPercent: drop,
    });
    setBusy(false);
    if (!result.ok || !result.data?.report) {
      setError(result.code || result.error || "AI_FAILED");
      return;
    }
    setReport(result.data.report);
  }

  useEffect(() => {
    if (!autoAnalyze || autoRan.current === importId) return;
    autoRan.current = importId;
    void analyze(false);
    // The analysis is cached server-side. A second mount reuses that report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyze, importId]);

  async function feedback(item: Recommendation, status: "approved" | "rejected") {
    if (!report) return;
    const result = await clientAdminFetch<{ priceChanged: boolean }>("/api/admin/pos/sales-ai", {
      action: "feedback",
      reportId: report.id,
      recommendationId: item.id,
      status,
    });
    if (!result.ok) {
      setError(result.code || "SAVE_FAILED");
      return;
    }
    setReport({
      ...report,
      recommendations: report.recommendations.map((row) => (row.id === item.id ? { ...row, feedback: status } : row)),
    });
  }

  async function ask() {
    setBusy(true);
    setAnswer(null);
    const result = await clientAdminFetch<{ answer?: string | null; note?: string }>("/api/admin/pos/sales-ai", {
      action: "ask",
      importId,
      question,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.code || "AI_FAILED");
      return;
    }
    setAnswer(result.data?.answer || result.data?.note || t("admin.salesAi.unavailable"));
  }

  const visible = report
    ? report.recommendations.filter((item) => {
        if (tab === "history") return Boolean(item.feedback);
        const kinds = tabKind(tab);
        return kinds ? kinds.includes(item.kind) : true;
      })
    : [];

  return (
    <AdminCard title={t("admin.salesAi.title")}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="turquoise" disabled={busy} onClick={() => void analyze(Boolean(report))}>
          <Sparkles className="h-4 w-4" />
          {report ? t("admin.salesAi.rerun") : t("admin.salesAi.analyze")}
        </Button>
        <p className="text-xs text-coffee/60">{t("admin.salesAi.noAutoPrice")}</p>
      </div>
      {busy && <p className="mt-3 text-sm text-coffee/70">{t("admin.insight.aiWorking")}</p>}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {report && (
        <div className="mt-4 space-y-4">
          {report.source === "rules" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.salesAi.unavailable")}</p>
          )}
          <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-3">
            <p>{t("admin.pos.dataPeriod")}: {report.periodFrom && report.periodTo ? `${report.periodFrom} – ${report.periodTo}` : t("admin.pos.dateUnrecognized")}</p>
            <p>{t("admin.pos.itemCount")}: {report.summary.productCount}</p>
            <p>{t("admin.pos.quantitySum")}: {report.summary.quantity}</p>
            <p>{t("admin.pos.reportedRevenue")}: {report.summary.reportedRevenue == null ? "—" : formatIls(report.summary.reportedRevenue)}</p>
            <p>{t("admin.costing.grossProfit")}: {report.summary.verifiedGross == null ? "—" : formatIls(report.summary.verifiedGross)}</p>
            <p>{t("admin.dishPricing.kpi.missingCost")}: {report.summary.missingCostCount}</p>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-sm",
                  tab === item ? "bg-turquoise text-warm-white" : "bg-beige/60 text-coffee"
                )}
              >
                {t(`admin.salesAi.tab.${item}`)}
              </button>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {visible.map((item) => (
              <article key={item.id} className="rounded-2xl border border-beige-dark/20 bg-warm-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{item.productName || item.why}</h3>
                  <span className="rounded-full bg-beige px-2 py-0.5 text-xs">{item.severity}</span>
                </div>
                <p className="mt-1 text-sm text-coffee/70">{item.narrative || item.why}</p>
                <p className="mt-2 text-sm">
                  {item.currentPrice == null ? "—" : formatIls(item.currentPrice)}
                  {item.proposedPrice != null ? ` → ${formatIls(item.proposedPrice)}` : ""}
                </p>
                {item.impact && (
                  <p className="mt-1 text-xs text-coffee/60">
                    {t("admin.salesAi.simulationNote")}: {item.impact.periodProfitBefore == null ? "—" : formatIls(item.impact.periodProfitBefore)} → {item.impact.periodProfitAfter == null ? "—" : formatIls(item.impact.periodProfitAfter)}
                  </p>
                )}
                {openId === item.id && (
                  <div className="mt-2 space-y-1 text-xs text-coffee/70">
                    {item.evidence.map((line) => <p key={line}>{line}</p>)}
                    {item.caveats.map((line) => <p key={line}>{line}</p>)}
                    <label className="block">
                      5/10/20%
                      <Input
                        className="mt-1 h-8"
                        inputMode="numeric"
                        value={String(drop)}
                        onChange={(event) => setDrop(Number(event.target.value) || 0)}
                      />
                    </label>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                    {t("admin.salesAi.simulate")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void feedback(item, "approved")}>
                    {t("admin.salesAi.approve")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void feedback(item, "rejected")}>
                    {t("admin.salesAi.reject")}
                  </Button>
                </div>
                {item.feedback && <p className="mt-2 text-xs text-emerald-800">{item.feedback}</p>}
              </article>
            ))}
          </div>
          <div className="rounded-2xl border border-beige-dark/20 p-3">
            <p className="text-sm font-semibold">{t("admin.salesAi.ask")}</p>
            <div className="mt-2 flex gap-2">
              <Input value={question} onChange={(event) => setQuestion(event.target.value)} />
              <Button type="button" variant="outline" disabled={busy || !question.trim()} onClick={() => void ask()}>
                {t("admin.salesAi.ask")}
              </Button>
            </div>
            {answer && <p className="mt-2 whitespace-pre-wrap text-sm">{answer}</p>}
          </div>
        </div>
      )}
    </AdminCard>
  );
}
