import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { ServiceError, failure, success, type ServiceResult } from "@/lib/errors";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { nowTimestamp, timestampToIso } from "@/types/firestore";
import {
  DEFAULT_BREAK_EVEN_SETTINGS,
  type BreakEvenFixedCost,
  type BreakEvenSettings,
  type BreakEvenSnapshot,
  type BreakEvenVariableCost,
  type BreakEvenVatMode,
  type CostFrequency,
  type VariableAppliesTo,
  type VariableCostKind,
} from "@/lib/breakeven/types";
import { snapshotFromResult } from "@/lib/breakeven/compute";
import type { BreakEvenResult } from "@/lib/breakeven/types";

const SETTINGS_DOC = "default";

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asFrequency(value: unknown): CostFrequency {
  return value === "daily" || value === "weekly" || value === "yearly" ? value : "monthly";
}

function asVatMode(value: unknown): BreakEvenVatMode {
  return value === "including" || value === "exempt" ? value : "before";
}

function asKind(value: unknown): VariableCostKind {
  return value === "percent" || value === "per_order" || value === "per_dish" ? value : "fixed";
}

function asAppliesTo(value: unknown): VariableAppliesTo | undefined {
  return value === "card" || value === "all" ? value : undefined;
}

function mapFixed(id: string, data: Record<string, unknown>): BreakEvenFixedCost {
  return {
    id,
    name: String(data.name ?? ""),
    amount: asNumber(data.amount),
    frequency: asFrequency(data.frequency),
    category: data.category ? String(data.category) : undefined,
    vatMode: asVatMode(data.vatMode),
    vatRate: data.vatRate == null ? null : asNumber(data.vatRate),
    active: data.active !== false,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

function mapVariable(id: string, data: Record<string, unknown>): BreakEvenVariableCost {
  return {
    id,
    name: String(data.name ?? ""),
    kind: asKind(data.kind),
    amount: asNumber(data.amount),
    frequency: data.frequency ? asFrequency(data.frequency) : undefined,
    appliesTo: asAppliesTo(data.appliesTo),
    vatMode: asVatMode(data.vatMode),
    vatRate: data.vatRate == null ? null : asNumber(data.vatRate),
    active: data.active !== false,
    createdAt: timestampToIso(data.createdAt as never),
    updatedAt: timestampToIso(data.updatedAt as never),
  };
}

function writeFailure(error: unknown, fallback: string): ServiceResult<never> {
  console.error("[breakeven] write failed", error);
  return failure(error instanceof Error ? error : new ServiceError(fallback, "UNKNOWN"));
}

export function subscribeToBreakEvenFixedCosts(
  onData: (items: BreakEvenFixedCost[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.breakEvenFixedCosts),
    (snap) => onData(snap.docs.map((item) => mapFixed(item.id, item.data() as Record<string, unknown>))),
    (error) => onError?.(error.message)
  );
}

export function subscribeToBreakEvenVariableCosts(
  onData: (items: BreakEvenVariableCost[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.breakEvenVariableCosts),
    (snap) => onData(snap.docs.map((item) => mapVariable(item.id, item.data() as Record<string, unknown>))),
    (error) => onError?.(error.message)
  );
}

export function subscribeToBreakEvenSettings(
  onData: (settings: BreakEvenSettings) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), COLLECTIONS.breakEvenSettings, SETTINGS_DOC),
    (snap) => {
      if (!snap.exists()) {
        onData({ ...DEFAULT_BREAK_EVEN_SETTINGS });
        return;
      }
      const data = snap.data();
      onData({
        operatingDays: Math.max(1, asNumber(data.operatingDays, DEFAULT_BREAK_EVEN_SETTINGS.operatingDays)),
        vatBasis: data.vatBasis === "including" ? "including" : "before",
        vatRate: asNumber(data.vatRate, DEFAULT_BREAK_EVEN_SETTINGS.vatRate),
        alertGap: asNumber(data.alertGap, DEFAULT_BREAK_EVEN_SETTINGS.alertGap),
        createdAt: data.createdAt ? timestampToIso(data.createdAt as never) : undefined,
        updatedAt: data.updatedAt ? timestampToIso(data.updatedAt as never) : undefined,
      });
    },
    (error) => onError?.(error.message)
  );
}

export function subscribeToBreakEvenSnapshots(
  onData: (items: BreakEvenSnapshot[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.breakEvenSnapshots),
    (snap) => {
      const items = snap.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          monthKey: String(data.monthKey ?? item.id),
          kind: data.kind === "scenario" ? "scenario" : "saved",
          revenue: data.revenue == null ? null : asNumber(data.revenue),
          fixedCosts: data.fixedCosts == null ? null : asNumber(data.fixedCosts),
          variableCosts: data.variableCosts == null ? null : asNumber(data.variableCosts),
          foodCost: data.foodCost == null ? null : asNumber(data.foodCost),
          contributionMargin: data.contributionMargin == null ? null : asNumber(data.contributionMargin),
          breakEvenRevenue: data.breakEvenRevenue == null ? null : asNumber(data.breakEvenRevenue),
          actualProfit: data.actualProfit == null ? null : asNumber(data.actualProfit),
          orders: data.orders == null ? null : asNumber(data.orders),
          averageOrderValue: data.averageOrderValue == null ? null : asNumber(data.averageOrderValue),
          createdAt: timestampToIso(data.createdAt as never),
        } satisfies BreakEvenSnapshot;
      });
      onData(items.sort((a, b) => b.monthKey.localeCompare(a.monthKey)));
    },
    (error) => onError?.(error.message)
  );
}

export async function saveBreakEvenSettings(settings: BreakEvenSettings): Promise<ServiceResult<BreakEvenSettings>> {
  try {
    const payload = sanitizeFirestoreData({
      operatingDays: Math.max(1, settings.operatingDays),
      vatBasis: settings.vatBasis,
      vatRate: settings.vatRate,
      alertGap: settings.alertGap,
      updatedAt: nowTimestamp(),
      createdAt: settings.createdAt ? undefined : nowTimestamp(),
    });
    await setDoc(doc(getDb(), COLLECTIONS.breakEvenSettings, SETTINGS_DOC), payload, { merge: true });
    return success(settings);
  } catch (error) {
    return writeFailure(error, "Failed to save break-even settings");
  }
}

export async function saveFixedCost(
  input: Omit<BreakEvenFixedCost, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<ServiceResult<string>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      name: input.name.trim(),
      amount: input.amount,
      frequency: input.frequency,
      category: input.category ?? null,
      vatMode: input.vatMode,
      vatRate: input.vatRate ?? null,
      active: input.active,
      updatedAt: now,
    });
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.breakEvenFixedCosts, input.id), payload);
      return success(input.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.breakEvenFixedCosts), { ...payload, createdAt: now });
    return success(ref.id);
  } catch (error) {
    return writeFailure(error, "Failed to save fixed cost");
  }
}

export async function saveVariableCost(
  input: Omit<BreakEvenVariableCost, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<ServiceResult<string>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      name: input.name.trim(),
      kind: input.kind,
      amount: input.amount,
      frequency: input.frequency ?? "monthly",
      appliesTo: input.appliesTo ?? null,
      vatMode: input.vatMode,
      vatRate: input.vatRate ?? null,
      active: input.active,
      updatedAt: now,
    });
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.breakEvenVariableCosts, input.id), payload);
      return success(input.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.breakEvenVariableCosts), { ...payload, createdAt: now });
    return success(ref.id);
  } catch (error) {
    return writeFailure(error, "Failed to save variable cost");
  }
}

export async function deleteFixedCost(id: string): Promise<ServiceResult<void>> {
  try {
    await deleteDoc(doc(getDb(), COLLECTIONS.breakEvenFixedCosts, id));
    return success(undefined);
  } catch (error) {
    return writeFailure(error, "Failed to delete fixed cost");
  }
}

export async function deleteVariableCost(id: string): Promise<ServiceResult<void>> {
  try {
    await deleteDoc(doc(getDb(), COLLECTIONS.breakEvenVariableCosts, id));
    return success(undefined);
  } catch (error) {
    return writeFailure(error, "Failed to delete variable cost");
  }
}

export async function saveBreakEvenSnapshot(
  monthKey: string,
  result: BreakEvenResult,
  kind: "saved" | "scenario" = "saved"
): Promise<ServiceResult<string>> {
  try {
    const id = kind === "scenario" ? `${monthKey}-scenario` : monthKey;
    const payload = sanitizeFirestoreData({
      ...snapshotFromResult(monthKey, result, kind),
      createdAt: nowTimestamp(),
    });
    await setDoc(doc(getDb(), COLLECTIONS.breakEvenSnapshots, id), payload, { merge: true });
    return success(id);
  } catch (error) {
    return writeFailure(error, "Failed to save snapshot");
  }
}
