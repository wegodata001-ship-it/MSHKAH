import type { FirestoreOrder } from "@/types/firestore";
import type { OrderEmailBase, OrderEmailItem } from "@/lib/email/templates";
import { getPortalAdminOrderUrl } from "@/lib/email/config";

export function timestampToIso(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

export function firestoreOrderToEmailPayload(
  orderId: string,
  data: FirestoreOrder
): OrderEmailBase {
  const items: OrderEmailItem[] = (data.items ?? []).map((item) => ({
    productName: item.productName,
    quantity: item.quantity,
    price: item.price,
    modifiers: item.modifiers?.map((m) => ({
      optionName: m.optionName,
      quantity: m.quantity,
    })),
    notes: item.notes,
    kitchenNotes: item.kitchenNotes,
  }));

  return {
    orderId,
    orderNumber: data.orderNumber,
    createdAt: timestampToIso(data.createdAt),
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    items,
    total: data.total,
    paymentMethod: data.paymentMethod,
    paymentStatus: data.paymentStatus,
    orderType: data.orderType,
    status: data.status,
    notes: data.notes,
    viewUrl: getPortalAdminOrderUrl(orderId),
  };
}
