export type BusinessType = "beverage" | "food" | "bakery" | "dessert" | "dairy";

export interface Category {
  id: string;
  name_he: string;
  name_ar: string;
  name_en: string;
  icon: string;
  image: string;
  color: string;
  sortOrder: number;
  active: boolean;
  parentId?: string | null;
}

export interface Product {
  id: string;
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
  image: string;
  /** Optional POS barcode / SKU. Missing on existing products. */
  barcode?: string;
  /** Sold by weight. Existing products default to false. */
  isWeighted?: boolean;
  /** Sale price includes VAT. Existing products default to true (no tax line in checkout). */
  includesVat?: boolean;
  isPopular: boolean;
  isNew: boolean;
  available: boolean;
  active: boolean;
  sortOrder: number;
  /** Temporary HYP / QA item. Exclude from real sales stats when supported. */
  isTestProduct?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  ordersCount: number;
  totalSpending: number;
  lastOrder: string;
  favoriteItems: string[];
  notes: string;
  avatar?: string;
}

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  basePrice?: number;
  modifiers?: import("@/types/modifiers").SelectedModifier[];
  notes?: string;
  kitchenNotes?: string[];
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal?: number;
  discount?: number;
  delivery?: number;
  total: number;
  paymentMethod?: string;
  paymentStatus?: PaymentStatus;
  paymentProvider?: string;
  paymentTransactionId?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerFullName?: string;
  adminNotificationStatus?: "SENDING" | "SENT" | "FAILED";
  customerConfirmationStatus?: "SENDING" | "SENT" | "FAILED";
  orderType?: "pickup" | "delivery";
  deliveryAddress?: string;
  notes?: string;
  /** True when the cart contained a marked test product (HYP ₪2 verification). */
  isTestOrder?: boolean;
  /** UI locale at checkout (ar/he/en). Optional on legacy orders. */
  locale?: "ar" | "he" | "en";
  createdAt: string;
  receivedAt?: string | null;
  confirmedAt?: string | null;
  preparationStartedAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  paidAt?: string | null;
  cancelReason?: string;
  cancelledBy?: string;
  alerts?: OrderStageAlerts;
}

export type OrderAlertState = {
  status?: "SENDING" | "SENT" | "FAILED";
  sentAt?: string | null;
  attemptedAt?: string | null;
  error?: string;
};

export type OrderStageAlerts = {
  receivedCritical?: OrderAlertState;
  preparingCritical?: OrderAlertState;
  readyCritical?: OrderAlertState;
  preparingEscalation?: OrderAlertState;
  readyEscalation?: OrderAlertState;
};

export interface CartItem {
  lineId: string;
  product: Product;
  quantity: number;
  selections: import("@/types/modifiers").SelectedModifier[];
  unitPrice: number;
  notes?: string;
  configurable?: boolean;
}

export interface ProductFilters {
  categoryId?: string;
  subcategoryId?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  isPopular?: boolean;
  isNew?: boolean;
  available?: boolean;
  active?: boolean;
  sortBy?: "newest" | "price-asc" | "price-desc" | "name-asc" | "popular";
}

export interface BannerSlide {
  id: string;
  title: string;
  subtitle: string;
  title_he?: string;
  title_ar?: string;
  title_en?: string;
  subtitle_he?: string;
  subtitle_ar?: string;
  subtitle_en?: string;
  button_he?: string;
  button_ar?: string;
  button_en?: string;
  image: string;
  mobileImage?: string;
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
