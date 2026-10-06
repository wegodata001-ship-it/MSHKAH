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

  const settled = await Promise.allSettled([
    enqueueNewOrderPrintJob(orderId, { ignoreAutoPrintGate: true }),
    notifyNewOrder(orderId),
    notifyCustomerPaymentSuccess(orderId),
  ]);

  const printResult = settled[0];
  if (printResult.status === "fulfilled") {
    const print = printResult.value;
    post.print = print.status === "created" || print.status === "already_exists" ? "CREATED" : "FAILED";
    paymentAudit("PRINT_JOB_CREATED", {
      orderId,
      paymentAttemptId: paymentId,
      extra: { printStatus: print.status },
    });
  } else {
    post.print = "FAILED";
    paymentAudit("PRINT_JOB_CREATED", {
      orderId,
      paymentAttemptId: paymentId,
      providerErrorCode:
        printResult.reason instanceof Error ? printResult.reason.message : "print_failed",
    });
  }

  const adminResult = settled[1];
  if (adminResult.status === "fulfilled") {
    const admin = adminResult.value;
    post.adminEmail = taskStatus(admin);
    paymentAudit("ADMIN_EMAIL_SENT", {
      orderId,
      paymentAttemptId: paymentId,
      extra: { adminEmail: admin.status },
    });
  } else {
    post.adminEmail = "FAILED";
    console.error("[hyp] admin email after pay failed", adminResult.reason);
  }

  const customerResult = settled[2];
  if (customerResult.status === "fulfilled") {
    post.customerEmail = taskStatus(customerResult.value);
  } else {
    post.customerEmail = "FAILED";
    paymentAudit("CUSTOMER_EMAIL_FAILED", {
      orderId,
      paymentAttemptId: paymentId,
      providerErrorCode:
        customerResult.reason instanceof Error ? customerResult.reason.message : "customer_email_failed",
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
