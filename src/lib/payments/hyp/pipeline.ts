import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { notifyNewOrder } from "@/lib/email/notifications";
import {
  notifyCustomerPaymentFailed,
  notifyCustomerPaymentSuccess,
} from "@/lib/email/notifications/customer-payment";
import { enqueueNewOrderPrintJob } from "@/lib/print-jobs/jobs";
import { paymentAudit } from "@/lib/payments/hyp/audit";

function taskStatus(result: { status: string }): "SENT" | "FAILED" | "SKIPPED" | "CREATED" {
  if (result.status === "sent" || result.status === "already_sent") return "SENT";
  if (result.status === "failed") return "FAILED";
  return "SKIPPED";
}

/** After PAID is committed. Failures never roll back payment. */
export async function runPaidPostPaymentTasks(orderId: string, paymentId: string): Promise<void> {
  const db = getAdminDb();
  const paymentRef = db.collection(COLLECTIONS.payments).doc(paymentId);
  const post: Record<string, string> = {
    message: "NOT_CONFIGURED",
    invoice: "PROVIDER_REQUIRED",
  };

  try {
    const print = await enqueueNewOrderPrintJob(orderId, { ignoreAutoPrintGate: true });
    post.print = print.status === "created" || print.status === "already_exists" ? "CREATED" : "FAILED";
    paymentAudit("PRINT_JOB_CREATED", {
      orderId,
      paymentAttemptId: paymentId,
      extra: { printStatus: print.status },
    });
  } catch (error) {
    post.print = "FAILED";
    paymentAudit("PRINT_JOB_CREATED", {
      orderId,
      paymentAttemptId: paymentId,
      providerErrorCode: error instanceof Error ? error.message : "print_failed",
    });
  }

  try {
    const admin = await notifyNewOrder(orderId);
    post.adminEmail = taskStatus(admin);
    paymentAudit(admin.status === "failed" ? "ADMIN_EMAIL_SENT" : "ADMIN_EMAIL_SENT", {
      orderId,
      paymentAttemptId: paymentId,
      extra: { adminEmail: admin.status },
    });
  } catch (error) {
    post.adminEmail = "FAILED";
    console.error("[hyp] admin email after pay failed", error);
  }

  try {
    const customer = await notifyCustomerPaymentSuccess(orderId);
    post.customerEmail = taskStatus(customer);
  } catch (error) {
    post.customerEmail = "FAILED";
    paymentAudit("CUSTOMER_EMAIL_FAILED", {
      orderId,
      paymentAttemptId: paymentId,
      providerErrorCode: error instanceof Error ? error.message : "customer_email_failed",
    });
  }

  await paymentRef
    .update({
      postPayment: post,
      updatedAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined);
}

export async function runFailedPostPaymentTasks(orderId: string, paymentId: string): Promise<void> {
  try {
    await notifyCustomerPaymentFailed(orderId);
  } catch (error) {
    paymentAudit("CUSTOMER_EMAIL_FAILED", {
      orderId,
      paymentAttemptId: paymentId,
      providerErrorCode: error instanceof Error ? error.message : "failure_email_failed",
    });
  }
}
