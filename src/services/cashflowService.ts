import { addDoc, collection, doc, onSnapshot, setDoc, updateDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sanitizeFirestoreData } from "@/lib/firebase/sanitize-firestore-data";
import { ServiceError, failure, success, type ServiceResult } from "@/lib/errors";
import { nowTimestamp, timestampToIso } from "@/types/firestore";
import type { CashFlowEntry } from "@/lib/cashflow/engine";

const SETTINGS_DOC = "default";

export type CashOpening = { amount: number; date: string };

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapEntry(id: string, data: Record<string, unknown>): CashFlowEntry {
  const history = Array.isArray(data.history)
    ? data.history.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return [{ at: String(row.at ?? ""), change: String(row.change ?? "") }];
      })
    : [];
  return {
    id,
    kind: data.kind === "settlement" || data.kind === "transfer" || data.kind === "override" || data.kind === "link" ? data.kind : "forecast",
    direction: data.direction === "in" || data.direction === "out" ? data.direction : undefined,
    amount: asNumber(data.amount) ?? undefined,
    date: data.date ? String(data.date) : undefined,
    description: data.description ? String(data.description) : undefined,
    counterparty: data.counterparty ? String(data.counterparty) : undefined,
    account: data.account ? String(data.account) : undefined,
    status: data.status === "done" || data.status === "cancelled" || data.status === "expected" ? data.status : undefined,
    fixedCostId: data.fixedCostId ? String(data.fixedCostId) : undefined,
    occurrenceKey: data.occurrenceKey ? String(data.occurrenceKey) : undefined,
    originalDate: data.originalDate ? String(data.originalDate) : undefined,
    scope: data.scope === "instance" || data.scope === "future" ? data.scope : undefined,
    invoiceId: data.invoiceId ? String(data.invoiceId) : undefined,
    appliesToKey: data.appliesToKey ? String(data.appliesToKey) : undefined,
    zReportId: data.zReportId ? String(data.zReportId) : undefined,
    paymentMethod: data.paymentMethod ? String(data.paymentMethod) : undefined,
    moneyLocation: data.moneyLocation === "cash" || data.moneyLocation === "card" || data.moneyLocation === "bank" ? data.moneyLocation : undefined,
    history,
  };
}

function writeFailure(error: unknown, fallback: string): ServiceResult<never> {
  console.error("[cashflow] write failed", error);
  return failure(error instanceof Error ? error : new ServiceError(fallback, "UNKNOWN"));
}

export function subscribeCashFlowEntries(
  onData: (items: CashFlowEntry[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.cashFlowEntries),
    (snap) => onData(snap.docs.map((item) => mapEntry(item.id, item.data() as Record<string, unknown>))),
    (error) => onError?.(error.message)
  );
}

export function subscribeCashOpening(
  onData: (opening: CashOpening | null) => void,
  onError?: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), COLLECTIONS.cashFlowSettings, SETTINGS_DOC),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      const amount = asNumber(data.amount);
      const date = String(data.date ?? "");
      onData(amount == null || !/^\d{4}-\d{2}-\d{2}$/.test(date) ? null : { amount, date });
    },
    (error) => onError?.(error.message)
  );
}

export async function saveCashOpening(opening: CashOpening): Promise<ServiceResult<CashOpening>> {
  try {
    await setDoc(
      doc(getDb(), COLLECTIONS.cashFlowSettings, SETTINGS_DOC),
      sanitizeFirestoreData({ amount: opening.amount, date: opening.date, updatedAt: nowTimestamp() }),
      { merge: true }
    );
    return success(opening);
  } catch (error) {
    return writeFailure(error, "Failed to save opening balance");
  }
}

export async function saveCashFlowEntry(input: CashFlowEntry): Promise<ServiceResult<string>> {
  try {
    const now = nowTimestamp();
    const payload = sanitizeFirestoreData({
      ...input,
      id: undefined,
      updatedAt: now,
      history: input.history ?? [],
    });
    if (input.id) {
      await updateDoc(doc(getDb(), COLLECTIONS.cashFlowEntries, input.id), payload);
      return success(input.id);
    }
    const ref = await addDoc(collection(getDb(), COLLECTIONS.cashFlowEntries), { ...payload, createdAt: now });
    return success(ref.id);
  } catch (error) {
    return writeFailure(error, "Failed to save cash flow entry");
  }
}

export function entryStamp(): string {
  return timestampToIso(nowTimestamp());
}
