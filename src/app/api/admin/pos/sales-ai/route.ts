import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { geminiGenerateJson } from "@/lib/ai/gemini-client";
import { GeminiRequestError, isGeminiConfigured } from "@/lib/ai/gemini-config";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { isValidSalesPeriod } from "@/lib/inventory/pos-excel";
import {
  adviseFromFacts,
  analyzeSalesLines,
  simulatePriceChange,
  type AdvisorCard,
  type VerifiedCost,
} from "@/lib/inventory/sales-analysis";
import type { PosImport } from "@/lib/inventory/types";

export const runtime = "nodejs";

const inflight = new Set<string>();

function factsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

async function loadVerifiedCosts(productIds: string[]): Promise<VerifiedCost[]> {
  const db = getAdminDb();
  const unique = [...new Set(productIds.filter(Boolean))];
  const costs: VerifiedCost[] = [];
  for (const id of unique) {
    const snap = await db.collection(COLLECTIONS.products).doc(id).get();
    if (!snap.exists) continue;
    const data = snap.data() as { price?: number; cost?: number; costVerified?: boolean };
    if (data.costVerified !== true || !(Number(data.cost) > 0)) continue;
    costs.push({
      productId: id,
      unitCost: Number(data.cost),
      basis: "manual",
      listPrice: Number.isFinite(Number(data.price)) ? Number(data.price) : null,
    });
  }
  return costs;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    action?: "analyze" | "ask" | "feedback";
    importId?: string;
    force?: boolean;
    question?: string;
    reportId?: string;
    recommendationId?: string;
    status?: "approved" | "rejected";
    reason?: string;
    demandDropPercent?: number;
    nextPrice?: number;
  } | null;
  const action = body?.action ?? "analyze";
  const db = getAdminDb();

  if (action === "feedback") {
    if (!body?.reportId || !body.recommendationId || (body.status !== "approved" && body.status !== "rejected")) {
      return Response.json({ ok: false, code: "VALIDATION" }, { status: 400 });
    }
    const ref = db.collection(COLLECTIONS.salesAiReports).doc(body.reportId);
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    const data = snap.data() as { recommendations?: Array<Record<string, unknown>> };
    const recommendations = (data.recommendations ?? []).map((item) =>
      item.id === body.recommendationId
        ? {
            ...item,
            feedback: body.status,
            feedbackReason: body.reason?.slice(0, 400) ?? null,
            feedbackBy: auth.email,
            feedbackAt: new Date().toISOString(),
            priceChanged: false,
          }
        : item
    );
    await ref.set({ recommendations, updatedAt: new Date().toISOString() }, { merge: true });
    return Response.json({ ok: true, priceChanged: false });
  }

  const importId = body?.importId?.trim();
  if (!importId) return Response.json({ ok: false, code: "IMPORT_REQUIRED" }, { status: 400 });
  const importSnap = await db.collection(COLLECTIONS.posImports).doc(importId).get();
  if (!importSnap.exists) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  const posImport = { id: importSnap.id, ...importSnap.data() } as PosImport;
  const verifiedCosts = await loadVerifiedCosts(
    (posImport.lines ?? []).map((line) => line.menuProductId || "").filter(Boolean)
  );
  const facts = analyzeSalesLines({
    lines: posImport.lines ?? [],
    verifiedCosts,
    periodRecognized: isValidSalesPeriod(posImport.periodFrom, posImport.periodTo),
  });
  const recommendations = adviseFromFacts(facts);

  if (action === "ask") {
    const question = body?.question?.trim().slice(0, 500) ?? "";
    if (!question) return Response.json({ ok: false, code: "VALIDATION" }, { status: 400 });
    if (!isGeminiConfigured()) {
      return Response.json({
        ok: true,
        source: "rules",
        answer: null,
        facts,
        note: "AI_NOT_CONFIGURED",
      });
    }
    try {
      const generated = await geminiGenerateJson({
        temperature: 0.2,
        parts: [{
          text: [
            "You are Mishkat Cafe's business advisor. Answer only from the JSON facts.",
            "Do not invent numbers. If a cost is missing, say it is missing.",
            "Reply in Hebrew. Keep it under 120 words.",
            `Question: ${question}`,
            JSON.stringify({
              period: { from: posImport.periodFrom ?? null, to: posImport.periodTo ?? null },
              summary: {
                productCount: facts.productCount,
                quantity: facts.quantity,
                reportedRevenue: facts.reportedRevenue,
                verifiedGross: facts.verifiedGross,
                missingCostCount: facts.missingCostCount,
              },
              products: facts.products.slice(0, 40).map((row) => ({
                name: row.name,
                quantity: row.quantity,
                revenue: row.reportedRevenue,
                averagePrice: row.averagePrice,
                verifiedUnitCost: row.verifiedUnitCost,
                verifiedGross: row.verifiedGross,
                foodCost: row.verifiedFoodCostPercent,
                anomalies: row.anomalies,
              })),
            }),
          ].join("\n"),
        }],
      });
      return Response.json({ ok: true, source: "ai", answer: generated.text, model: generated.model, requestId: generated.requestId });
    } catch (error) {
      const code = error instanceof GeminiRequestError ? error.code : "AI_FAILED";
      return Response.json({ ok: false, code, facts }, { status: code === "PROVIDER_RATE_LIMIT" || code === "QUOTA_EXCEEDED" ? 429 : 502 });
    }
  }

  const hash = factsHash({
    importId,
    periodFrom: posImport.periodFrom ?? null,
    periodTo: posImport.periodTo ?? null,
    products: facts.products.map((row) => [row.key, row.quantity, row.reportedRevenue, row.verifiedUnitCost, row.anomalies.join(",")]),
  });
  const reportId = `sales-${importId}-${hash}`;
  const existing = await db.collection(COLLECTIONS.salesAiReports).doc(reportId).get();
  if (existing.exists && !body?.force) {
    return Response.json({ ok: true, cached: true, report: { id: reportId, ...existing.data() } });
  }
  if (inflight.has(reportId)) return Response.json({ ok: false, code: "IN_PROGRESS" }, { status: 409 });
  inflight.add(reportId);
  try {
    let narrative: Record<string, string> = {};
    let source: "ai" | "rules" = "rules";
    let model: string | null = null;
    let requestId: string | null = null;
    if (isGeminiConfigured()) {
      try {
        const generated = await geminiGenerateJson({
          temperature: 0.2,
          parts: [{
            text: [
              "Write a short Hebrew explanation for each recommendation id.",
              "Use only the supplied numbers. Do not add products or prices that are not in the JSON.",
              "Return JSON: {\"notes\":[{\"id\":\"...\",\"text\":\"...\"}]}",
              JSON.stringify({ recommendations, facts: { ...facts, products: facts.products.slice(0, 40) } }),
            ].join("\n"),
          }],
        });
        model = generated.model;
        requestId = generated.requestId;
        const match = generated.text.match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) as { notes?: Array<{ id?: string; text?: string }> } : null;
        for (const note of parsed?.notes ?? []) {
          if (note.id && note.text && recommendations.some((card) => card.id === note.id)) {
            narrative[note.id] = String(note.text).slice(0, 600);
          }
        }
        source = "ai";
      } catch {
        source = "rules";
      }
    }
    const withImpact = recommendations.map((card) => attachImpact(card, facts, body?.demandDropPercent ?? 0));
    const report = {
      importId,
      fileName: posImport.fileName,
      periodFrom: posImport.periodFrom ?? null,
      periodTo: posImport.periodTo ?? null,
      factsHash: hash,
      source,
      model,
      requestId,
      summary: {
        productCount: facts.productCount,
        quantity: facts.quantity,
        reportedRevenue: facts.reportedRevenue,
        verifiedGross: facts.verifiedGross,
        missingCostCount: facts.missingCostCount,
        unmatchedCount: facts.unmatchedCount,
        recommendationCount: withImpact.length,
      },
      recommendations: withImpact.map((card) => ({
        ...card,
        narrative: narrative[card.id] ?? null,
        feedback: null,
        priceChanged: false,
      })),
      createdBy: auth.email,
      createdAt: new Date().toISOString(),
    };
    await db.collection(COLLECTIONS.salesAiReports).doc(reportId).set(report);
    return Response.json({ ok: true, cached: false, report: { id: reportId, ...report }, facts });
  } finally {
    inflight.delete(reportId);
  }
}

function attachImpact(card: AdvisorCard, facts: ReturnType<typeof analyzeSalesLines>, demandDropPercent: number) {
  const product = facts.products.find((row) => row.key === card.productKey);
  if (!product || card.proposedPrice == null || product.averagePrice == null) {
    return { ...card, impact: null };
  }
  return {
    ...card,
    impact: simulatePriceChange({
      currentPrice: product.averagePrice,
      nextPrice: card.proposedPrice,
      quantity: product.quantity,
      verifiedUnitCost: product.verifiedUnitCost,
      demandDropPercent,
    }),
  };
}
