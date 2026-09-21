export type DemoType =
  | "ai_chat"
  | "bot_simulator"
  | "landing_builder"
  | "content_ai"
  | "catalog_builder"
  | "ad_slot_preview"
  | "studio_tool";
export type DeliveryType = "link" | "text";
// "usdt" = legacy self-attested manual crypto (kept for old rows' display
// only, no longer offered in OrderForm — replaced by "crypto_auto" below).
// "crypto_auto" = real NOWPayments checkout, auto-approved by its webhook.
export type PaymentMethod = "bank" | "usdt" | "crypto_auto";
export type OrderStatus = "pending" | "approved" | "rejected";

export interface Category {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string | null;
  description_ar: string | null;
  icon: string;
  sort_order: number;
}

export interface Service {
  id: string;
  category_id: string;
  slug: string;
  name_ar: string;
  subcategory: string | null;
  short_desc_ar: string | null;
  long_desc_ar: string | null;
  price_usd: number;
  demo_type: DemoType;
  delivery_type: DeliveryType;
  delivery_content: string | null;
  tool_route: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface StoreProduct {
  id: string;
  title_ar: string;
  description_ar: string | null;
  image_url: string | null;
  affiliate_url: string;
  category: string;
  price_display: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  order_code: string;
  service_id: string;
  customer_name: string;
  customer_contact: string;
  payment_method: PaymentMethod;
  transfer_reference: string;
  amount_usd: number;
  status: OrderStatus;
  delivery_content: string | null;
  admin_note: string | null;
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  created_at: string;
  decided_at: string | null;
  services?: Pick<Service, "name_ar" | "slug">;
}
