import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const PATCH: Record<string, Record<string, string>> = {
  ar: {
    "checkout.paymentCard": "بطاقة ائتمان",
    "checkout.paymentCardHint": "دفع آمن بواسطة HYP",
    "checkout.paySecure": "الدفع الآمن بالبطاقة",
    "checkout.redirecting": "جارٍ تحويلك إلى صفحة الدفع الآمنة...",
    "checkout.paymentCash": "نقداً",
    "checkout.paymentCashHint": "الدفع عند الاستلام",
    "checkout.placeOrder": "تأكيد الطلب",
    "checkout.paymentSuccessTitle": "تم الدفع بنجاح",
    "checkout.paymentFailedTitle": "لم تكتمل عملية الدفع",
    "checkout.paymentMethodCard": "بطاقة ائتمان",
    "checkout.hypRedirectHint": "سيتم تحويلك إلى صفحة الدفع الآمنة الخاصة بـ HYP",
    "checkout.hypOpenError": "تعذر فتح صفحة الدفع.\nيرجى المحاولة مرة أخرى.",
  },
  he: {
    "checkout.paymentCard": "אשראי",
    "checkout.paymentCardHint": "תשלום מאובטח באמצעות HYP",
    "checkout.paySecure": "תשלום מאובטח באשראי",
    "checkout.redirecting": "מעבירים אותך לתשלום המאובטח...",
    "checkout.paymentCash": "מזומן",
    "checkout.paymentMethodCard": "כרטיס אשראי",
    "checkout.hypRedirectHint": "מועברים לדף התשלום המאובטח של HYP",
    "checkout.hypOpenError": "לא הצלחנו לפתוח את דף התשלום. נסו שוב.",
  },
  en: {
    "checkout.paymentCard": "Credit Card",
    "checkout.paymentCardHint": "Secure payment via HYP",
    "checkout.paySecure": "Secure Card Payment",
    "checkout.paymentCash": "Cash",
    "checkout.paymentMethodCard": "Credit Card",
    "checkout.hypRedirectHint": "You will be redirected to the secure HYP payment page",
    "checkout.hypOpenError": "Could not open the payment page.\nPlease try again.",
  },
};

async function main() {
  const db = getAdminDb();
  for (const [locale, strings] of Object.entries(PATCH)) {
    const ref = db.collection(COLLECTIONS.uiTranslations).doc(locale);
    const snap = await ref.get();
    const current = (snap.data()?.strings ?? {}) as Record<string, string>;
    const next = { ...current, ...strings };
    await ref.set(
      {
        locale,
        strings: next,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const changed = Object.keys(strings).filter((key) => current[key] !== strings[key]);
    process.stdout.write(`${locale} patched keys: ${changed.length}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
