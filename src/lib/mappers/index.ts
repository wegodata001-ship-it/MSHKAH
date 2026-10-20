import type {
  FirestoreCategory,
  FirestoreProduct,
  FirestoreCustomer,
  FirestoreOrder,
  FirestoreBanner,
  FirestoreDoc,
} from "@/types/firestore";
import { timestampToIso } from "@/types/firestore";
import { normalizeImageUrl } from "@/lib/menu/placeholders";
import type {
  Category,
  Product,
  Customer,
  Order,
  BannerSlide,
  BusinessType,
} from "@/types";

/** Legacy docs stored Hebrew in `nameAr` before trilingual migration */
function readNameHe(doc: { nameHe?: string; nameAr?: string }): string {
  return doc.nameHe ?? doc.nameAr ?? "";
}

function readNameAr(doc: { nameHe?: string; nameAr?: string }): string {
  if (doc.nameHe && doc.nameAr && doc.nameHe !== doc.nameAr) return doc.nameAr;
  return doc.nameAr ?? "";
}

function readDescription(
  doc: { descriptionHe?: string; descriptionAr?: string; descriptionEn?: string; description?: string },
  lang: "he" | "ar" | "en"
): string {
  const legacy = doc.description ?? "";
  switch (lang) {
    case "he":
      return doc.descriptionHe ?? legacy;
    case "ar":
      return doc.descriptionAr ?? legacy;
    case "en":
      return doc.descriptionEn ?? legacy;
  }
}

function readBarcode(doc: { barcode?: string | number; sku?: string | number }): string {
  const raw = doc.barcode ?? doc.sku;
  if (raw == null || raw === "") return "";
  return String(raw);
}

export function mapCategory(doc: FirestoreDoc<FirestoreCategory>): Category {
  return {
    id: doc.id,
    name_he: readNameHe(doc),
    name_ar: readNameAr(doc),
    name_en: doc.nameEn ?? "",
    icon: doc.icon,
    image: normalizeImageUrl(doc.imageUrl) ?? "",
    color: doc.color ?? "#8B6914",
    sortOrder: doc.sortOrder,
    active: doc.active,
    parentId: doc.parentId ?? null,
  };
}

export function mapProduct(doc: FirestoreDoc<FirestoreProduct>): Product {
  return {
    id: doc.id,
    name_he: readNameHe(doc),
    name_ar: readNameAr(doc),
    name_en: doc.nameEn ?? "",
    description_he: readDescription(doc, "he"),
    description_ar: readDescription(doc, "ar"),
    description_en: readDescription(doc, "en"),
    categoryId: doc.categoryId,
    subcategoryId: doc.subcategoryId ?? null,
    price: doc.price,
    cost: doc.cost ?? 0,
    costVerified: (doc as unknown as { costVerified?: boolean }).costVerified ?? false,
    costVerifiedBy: (doc as unknown as { costVerifiedBy?: string | null }).costVerifiedBy ?? null,
    costVerifiedAt: (doc as unknown as { costVerifiedAt?: string | null }).costVerifiedAt ?? null,
    profit: doc.profit ?? 0,
    businessType: (doc.businessType ?? "food") as BusinessType,
    image: normalizeImageUrl(doc.imageUrl) ?? "",
    barcode: readBarcode(doc),
    isWeighted: doc.isWeighted ?? doc.weighted ?? false,
    includesVat: doc.includesVat ?? doc.vatIncluded ?? true,
    isPopular: doc.popular,
    isNew: doc.newProduct,
    available: doc.available,
    active: doc.active ?? true,
    sortOrder: doc.sortOrder,
    hidden: doc.hidden === true,
    isTestProduct: doc.isTestProduct === true,
    createdAt: timestampToIso(doc.createdAt),
    updatedAt: timestampToIso(doc.updatedAt),
  };
}

export function mapCustomer(doc: FirestoreDoc<FirestoreCustomer>): Customer {
  return {
    id: doc.id,
    name: doc.name,
    phone: doc.phone,
    // Email was always written through the admin form but never surfaced
    // back to the client. The loyalty club relies on an email key to tag
    // members, so we expose it here. Older docs that omitted the field
    // simply resolve to `null`.
    email: (doc as unknown as { email?: string | null }).email ?? null,
    address: doc.address,
    ordersCount: doc.ordersCount,
    totalSpending: doc.totalSpending ?? 0,
    lastOrder: timestampToIso(doc.lastOrder),
    favoriteItems: doc.favoriteProducts,
    notes: doc.notes ?? "",
  };
}

export function mapOrder(doc: FirestoreDoc<FirestoreOrder>): Order {
  return {
    id: doc.id,
    orderNumber: doc.orderNumber,
    customerId: doc.customerId,
    customerName: doc.customerName,
    status: doc.status,
    items: doc.items.map((item) => ({
      ...item,
      modifiers: item.modifiers?.map((m) => ({
        groupId: m.groupId,
        groupName: m.groupName,
        optionId: m.optionId,
        optionName: m.optionName,
        priceDelta: m.priceDelta,
        quantity: m.quantity,
        kitchenNote: m.kitchenNote,
      })),
    })),
    subtotal: doc.subtotal,
    discount: doc.discount,
    delivery: doc.delivery,
    total: doc.total,
    paymentMethod: doc.paymentMethod,
    paymentStatus: doc.paymentStatus ?? "pending",
    paymentProvider: doc.paymentProvider,
    paymentTransactionId: doc.paymentTransactionId,
    customerPhone: doc.customerPhone,
    customerEmail: doc.customerEmail,
    customerFullName: doc.customerFullName,
    customerConfirmationStatus:
      doc.notifications &&
      typeof doc.notifications === "object" &&
      doc.notifications.customerConfirmationEmail &&
      typeof doc.notifications.customerConfirmationEmail === "object"
        ? doc.notifications.customerConfirmationEmail.status
        : undefined,
    adminNotificationStatus:
      doc.notifications &&
      typeof doc.notifications === "object" &&
      doc.notifications.newOrderEmail &&
      typeof doc.notifications.newOrderEmail === "object"
        ? doc.notifications.newOrderEmail.status
        : undefined,
    orderType: doc.orderType,
    deliveryAddress: doc.deliveryAddress,
    notes: doc.notes,
    isTestOrder: doc.isTestOrder === true,
    locale: doc.locale,
    createdAt: timestampToIso(doc.createdAt),
    receivedAt: doc.receivedAt ? timestampToIso(doc.receivedAt) : null,
    confirmedAt: doc.confirmedAt ? timestampToIso(doc.confirmedAt) : null,
    preparationStartedAt: doc.preparationStartedAt
      ? timestampToIso(doc.preparationStartedAt)
      : null,
    readyAt: doc.readyAt ? timestampToIso(doc.readyAt) : null,
    deliveredAt: doc.deliveredAt ? timestampToIso(doc.deliveredAt) : doc.completedAt ? timestampToIso(doc.completedAt) : null,
    completedAt: doc.completedAt ? timestampToIso(doc.completedAt) : null,
    cancelledAt: doc.cancelledAt ? timestampToIso(doc.cancelledAt) : null,
    paidAt: doc.paidAt ? timestampToIso(doc.paidAt) : null,
    cancelReason: doc.cancelReason,
    cancelledBy: doc.cancelledBy,
    alerts: doc.alerts
      ? {
          receivedCritical: mapAlert(doc.alerts.receivedCritical),
          preparingCritical: mapAlert(doc.alerts.preparingCritical),
          readyCritical: mapAlert(doc.alerts.readyCritical),
          preparingEscalation: mapAlert(doc.alerts.preparingEscalation),
          readyEscalation: mapAlert(doc.alerts.readyEscalation),
        }
      : undefined,
  };
}

function mapAlert(alert?: { status?: "SENDING" | "SENT" | "FAILED"; sentAt?: unknown; attemptedAt?: unknown; lastError?: string }) {
  if (!alert) return undefined;
  return {
    status: alert.status,
    sentAt: alert.sentAt ? timestampToIso(alert.sentAt as never) : null,
    attemptedAt: alert.attemptedAt ? timestampToIso(alert.attemptedAt as never) : null,
    error: alert.lastError,
  };
}

function isBannerScheduled(banner: FirestoreBanner): boolean {
  const now = Date.now();
  if (banner.startDate && new Date(banner.startDate).getTime() > now) return false;
  if (banner.endDate && new Date(banner.endDate).getTime() < now) return false;
  return true;
}

export function mapBanner(doc: FirestoreDoc<FirestoreBanner>): BannerSlide {
  return {
    id: doc.id,
    title: doc.title,
    subtitle: doc.subtitle,
    title_he: doc.titleHe,
    title_ar: doc.titleAr,
    title_en: doc.titleEn,
    subtitle_he: doc.subtitleHe,
    subtitle_ar: doc.subtitleAr,
    subtitle_en: doc.subtitleEn,
    button_he: doc.buttonHe,
    button_ar: doc.buttonAr,
    button_en: doc.buttonEn,
    image: normalizeImageUrl(doc.imageUrl) ?? "",
    mobileImage: normalizeImageUrl(doc.mobileImageUrl) ?? undefined,
    cta: doc.cta,
    ctaUrl: doc.ctaUrl,
    ctaAction: doc.ctaAction ?? (doc.ctaUrl ? "link" : doc.cta ? "link" : "none"),
    ctaTargetId: doc.ctaTargetId,
    desktopPositionX: doc.desktopPositionX ?? 50,
    desktopPositionY: doc.desktopPositionY ?? 50,
    mobilePositionX: doc.mobilePositionX ?? doc.desktopPositionX ?? 50,
    mobilePositionY: doc.mobilePositionY ?? doc.desktopPositionY ?? 50,
    desktopZoom: doc.desktopZoom ?? 1,
    mobileZoom: doc.mobileZoom ?? 1,
    active: doc.active,
    sortOrder: doc.sortOrder,
    startDate: doc.startDate,
    endDate: doc.endDate,
  };
}

export function isBannerLive(banner: BannerSlide, now = Date.now()): boolean {
  if (!banner.active) return false;
  if (banner.startDate && new Date(banner.startDate).getTime() > now) return false;
  if (banner.endDate && new Date(banner.endDate).getTime() < now) return false;
  return true;
}

export { isBannerScheduled };

/** Firestore write shape from app product */
export function productToFirestore(input: {
  name_he: string;
  name_ar: string;
  name_en: string;
  description_he: string;
  description_ar: string;
  description_en: string;
  categoryId: string;
  subcategoryId?: string | null;
  price: number;
  cost: number;
  profit: number;
  businessType: BusinessType;
  imageUrl: string;
  available: boolean;
  popular: boolean;
  newProduct: boolean;
  active: boolean;
  sortOrder: number;
}) {
  return {
    nameHe: input.name_he,
    nameAr: input.name_ar,
    nameEn: input.name_en,
    descriptionHe: input.description_he,
    descriptionAr: input.description_ar,
    descriptionEn: input.description_en,
    categoryId: input.categoryId,
    ...(input.subcategoryId ? { subcategoryId: input.subcategoryId } : {}),
    price: input.price,
    cost: input.cost,
    profit: input.profit,
    businessType: input.businessType,
    imageUrl: input.imageUrl,
    available: input.available,
    popular: input.popular,
    newProduct: input.newProduct,
    active: input.active,
    sortOrder: input.sortOrder,
  };
}

export function categoryToFirestore(input: {
  name_he: string;
  name_ar: string;
  name_en: string;
  icon: string;
  imageUrl?: string;
  color?: string;
  sortOrder: number;
  active: boolean;
  parentId?: string | null;
}) {
  return {
    nameHe: input.name_he,
    nameAr: input.name_ar,
    nameEn: input.name_en,
    icon: input.icon,
    imageUrl: input.imageUrl ?? "",
    color: input.color ?? "#8B6914",
    sortOrder: input.sortOrder,
    active: input.active,
    ...(input.parentId ? { parentId: input.parentId } : {}),
  };
}
