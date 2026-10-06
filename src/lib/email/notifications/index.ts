export { notifyNewOrder, notifyNewOrderEmail } from "@/lib/email/notifications/new-order";
export { notifyOrderUpdated } from "@/lib/email/notifications/order-updated";
export { notifyOrderCancelled } from "@/lib/email/notifications/order-cancelled";
export { notifyCriticalOrderFailure } from "@/lib/email/notifications/critical-failure";
export {
  notifyCustomerPaymentSuccess,
  notifyCustomerPaymentFailed,
} from "@/lib/email/notifications/customer-payment";
export type { NotifyResult } from "@/lib/email/notifications/new-order";
