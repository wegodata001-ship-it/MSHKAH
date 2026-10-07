import { Timestamp } from "firebase/firestore";
import type { OrderStatus, PaymentStatus } from "@/types";

import type { BusinessType } from "@/types";

export interface FirestoreCategory {
  nameHe: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  imageUrl: string;
  color?: string;
  sortOrder: number;
  active: boolean;
  parentId?: string | null;
}

export interface FirestoreProduct {
  nameHe: string;
  nameAr: string;
  nameEn: string;
  descriptionHe?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  /** @deprecated legacy single description */
  description?: string;
  categoryId: string;
  subcategoryId?: string | null;
  price: number;
  cost: number;
  profit: number;
  businessType: BusinessType;
  imageUrl: string;
  barcode?: string;
  sku?: string;
  isWeighted?: boolean;
  weighted?: boolean;
  includesVat?: boolean;
  vatIncluded?: boolean;
  available: boolean;
  popular: boolean;
  newProduct: boolean;
  active: boolean;
  sortOrder: number;
  isTestProduct?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FirestoreCustomer {
  name: string;
  phone: string;
  email: string;
  address: string;
  favoriteProducts: string[];
  notes?: string;
  ordersCount: number;
  totalSpending?: number;
  lastOrder: Timestamp | null;
  createdAt: Timestamp;
}

export interface FirestoreOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  basePrice?: number;
  modifiers?: import("@/types/modifier-firestore").FirestoreOrderModifier[];
  notes?: string;
  kitchenNotes?: string[];
}

export type FirestoreOrderAlert = {
  status?: "SENDING" | "SENT" | "FAILED";
  sentAt?: Timestamp | null;
  attemptedAt?: Timestamp | null;
  claimedAt?: Timestamp | null;
  failedAt?: Timestamp | null;
  lastAttemptAt?: Timestamp | null;
  lastError?: string;
  messageId?: string;
  attempts?: number;
};

export interface FirestoreOrder {
  orderNumber: string;
  customerId: string;
  customerName: string;
  items: FirestoreOrderItem[];
  status: OrderStatus;
  subtotal: number;
  discount: number;
  delivery: number;
  total: number;
  paymentMethod: string;
  paymentStatus?: PaymentStatus;
  paymentProvider?: string;
  paymentTransactionId?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerFullName?: string;
  orderType?: "pickup" | "delivery";
  deliveryAddress?: string;
  notes: string;
  isTestOrder?: boolean;
  /** UI locale at checkout (ar/he/en). Optional on legacy orders. */
  locale?: "ar" | "he" | "en";
  createdAt: Timestamp;
  receivedAt?: Timestamp | null;
  confirmedAt?: Timestamp | null;
  preparationStartedAt?: Timestamp | null;
  readyAt?: Timestamp | null;
  deliveredAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  alerts?: {
    receivedCritical?: FirestoreOrderAlert;
    preparingCritical?: FirestoreOrderAlert;
    readyCritical?: FirestoreOrderAlert;
    preparingEscalation?: FirestoreOrderAlert;
    readyEscalation?: FirestoreOrderAlert;
  };
  cancelReason?: string;
  cancelledBy?: string;
  /** Server-managed email notification flags (Admin SDK only). */
  notifications?: {
    newOrderEmail?: {
      status: "SENDING" | "SENT" | "FAILED";
      provider?: "BREVO";
      claimedAt?: Timestamp | null;
      sentAt?: Timestamp | null;
      failedAt?: Timestamp | null;
      lastAttemptAt?: Timestamp | null;
      messageId?: string;
      lastError?: string;
      attempts?: number;
      fingerprint?: string;
    };
    orderUpdatedEmail?: {
      status: "SENDING" | "SENT" | "FAILED";
      provider?: "BREVO";
      claimedAt?: Timestamp | null;
      sentAt?: Timestamp | null;
      failedAt?: Timestamp | null;
      lastAttemptAt?: Timestamp | null;
      messageId?: string;
      lastError?: string;
      attempts?: number;
      fingerprint?: string;
    };
    customerConfirmationEmail?: {
      status: "SENDING" | "SENT" | "FAILED";
      provider?: "BREVO";
      claimedAt?: Timestamp | null;
      sentAt?: Timestamp | null;
      failedAt?: Timestamp | null;
      lastAttemptAt?: Timestamp | null;
      messageId?: string;
      lastError?: string;
      attempts?: number;
    };
    customerFailureEmail?: {
      status: "SENDING" | "SENT" | "FAILED";
      provider?: "BREVO";
      claimedAt?: Timestamp | null;
      sentAt?: Timestamp | null;
      failedAt?: Timestamp | null;
      lastAttemptAt?: Timestamp | null;
      messageId?: string;
      lastError?: string;
      attempts?: number;
    };
    orderCancelledEmail?: {
      status: "SENDING" | "SENT" | "FAILED";
      provider?: "BREVO";
      claimedAt?: Timestamp | null;
      sentAt?: Timestamp | null;
      failedAt?: Timestamp | null;
      lastAttemptAt?: Timestamp | null;
      messageId?: string;
      lastError?: string;
      attempts?: number;
    };
    /** Legacy compatibility — true only after confirmed SENT */
    newOrderEmailSent?: boolean;
    newOrderEmailSentAt?: Timestamp | null;
    newOrderEmailProvider?: string;
    newOrderEmailLastError?: string;
    newOrderEmailFailedAt?: Timestamp | null;
  };
}

export interface FirestoreBanner {
  title: string;
  subtitle: string;
  titleHe?: string;
  titleAr?: string;
  titleEn?: string;
  subtitleHe?: string;
  subtitleAr?: string;
  subtitleEn?: string;
  buttonHe?: string;
  buttonAr?: string;
  buttonEn?: string;
  imageUrl: string;
  mobileImageUrl?: string;
  cta?: string;
  ctaUrl?: string;
  ctaAction?: "none" | "link" | "product" | "category";
  ctaTargetId?: string;
  desktopPositionX?: number;
  desktopPositionY?: number;
  mobilePositionX?: number;
  mobilePositionY?: number;
  desktopZoom?: number;
  mobileZoom?: number;
  active: boolean;
  sortOrder: number;
  startDate?: string;
  endDate?: string;
}

export interface FirestoreUser {
  email: string;
  displayName: string;
  role: "Admin" | "Manager" | "Employee";
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FirestoreSettings {
  storeName: string;
  logoUrl: string;
  storeImageUrl: string;
  phone: string;
  address: string;
  hours: string;
  currency: string;
  theme: {
    primary: string;
    accent: string;
    background: string;
  };
  seo?: { title: string; description: string };
  social?: { instagram: string; facebook: string; whatsapp: string };
  mapsUrl?: string;
  faviconUrl?: string;
  showProductThumbnails?: boolean;
  updatedAt: Timestamp;
}

export interface FirestoreUiTranslations {
  locale: string;
  strings: Record<string, string>;
  version: number;
  updatedAt?: Timestamp;
}

export type FirestoreDoc<T> = T & { id: string };

export function timestampToIso(value: Timestamp | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value.toDate().toISOString();
}

export function isoToTimestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}
