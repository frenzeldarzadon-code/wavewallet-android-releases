/**
 * Retail store — physical goods sold by one shop.
 *
 * Everything here is scoped to a single ecosystem: products, stock, orders,
 * ratings and payment options belong to that shop only, and the database
 * re-checks membership and admin rights on every call. Credits are held when
 * an order is placed and returned in full when it is rejected or cancelled,
 * so an unconfirmed order never permanently consumes a wallet.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_UPLOAD_BYTES,
  REWARD_TARGET,
  loadImage,
  optimizeImage,
  optimizedName,
  validateImageFile,
  type CropRect,
  type ImageTarget,
} from "@/lib/image-optimize";

export const RETAIL_IMAGE_BUCKET = "retail-images";
export const MAX_RETAIL_IMAGE_BYTES = MAX_UPLOAD_BYTES;

export type Fulfillment = "pickup" | "delivery";
/** `cod` = cash on delivery floated by a collector's Universe coins (R6). */
export type PaymentMethod = "cash" | "credit" | "cod";
export type OrderStatus = "pending" | "approved" | "rejected" | "cancelled";
/** Non-financial fulfillment progress of an order (R5). Money state lives in `status`. */
export type FulfillmentStatus =
  | "awaiting"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "completed"
  | "closed";
/** Collector request state on a COD order (R6). Coins are only held once `approved`. */
export type CollectorStatus = "none" | "proposed" | "approved" | "declined";

export interface StoreSettings {
  voucherEnabled: boolean;
  retailEnabled: boolean;
  cashEnabled: boolean;
  creditEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  publicStorefront: boolean;
  /** Only returned to the shop admin / platform owner. */
  contactEmail: string | null;
  /** R6 — cash on delivery (Universe shops only). */
  codEnabled: boolean;
  /** Seller-set flat delivery fee, outside the platform fee. */
  deliveryFee: number;
  /** Shop-admin split of the delivery fee; must total exactly 100. */
  deliveryPct: number;
  collectorPct: number;
  /** Storefront identity (presentation only). */
  logoPath: string | null;
  coverPath: string | null;
  /** False while the seller has paused NEW orders; placed orders continue. */
  acceptingOrders: boolean;
  pausedNote: string | null;
  theme: "clear" | "fresh" | "warm";
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  voucherEnabled: true,
  retailEnabled: false,
  cashEnabled: true,
  creditEnabled: true,
  pickupEnabled: true,
  deliveryEnabled: true,
  publicStorefront: true,
  contactEmail: null,
  codEnabled: false,
  deliveryFee: 0,
  deliveryPct: 0,
  collectorPct: 0,
  logoPath: null,
  coverPath: null,
  acceptingOrders: true,
  pausedNote: null,
  theme: "clear",
};

export interface RetailProduct {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  price: number;
  stock: number;
  sold_count: number;
  public_visible: boolean;
  rating_avg: number;
  rating_count: number;
  brand?: string | null;
  variant?: string | null;
  size_label?: string | null;
  unit?: string | null;
  category?: string | null;
  /** Bulk price, applied by the shop from `wholesale_min_qty` pieces up. */
  wholesale_price?: number;
  wholesale_min_qty?: number;
}

export interface OrderItem {
  product_id: string;
  name: string;
  quantity: number;
  /** Applicable seller unit amount snapshotted at order time. */
  unit_price: number;
  /** Customer line total (seller amount + fee) snapshotted at order time. */
  line_total: number;
  regular_unit_price?: number;
  wholesale_applied?: boolean;
  seller_line_total?: number;
  fee_amount?: number;
}

export interface RetailOrder {
  id: string;
  order_no: string;
  customer_id?: string;
  customer_name?: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  fulfillment_status: FulfillmentStatus;
  delivered_at?: string | null;
  completed_at?: string | null;
  shop_name?: string | null;
  seller_id?: string | null;
  seller_name?: string | null;
  delivery_address: string | null;
  delivery_notes: string | null;
  payment_method: PaymentMethod;
  /** Product amount (seller total + embedded platform fee). Delivery fee is separate. */
  total: number;
  seller_total?: number;
  platform_fee_percent?: number;
  platform_fee_amount?: number;
  decision_note: string | null;
  created_at: string;
  items: OrderItem[];
  /* ---- R6 delivery / cash-on-delivery (snapshotted per order) ---- */
  delivery_fee?: number;
  delivery_split_delivery_pct?: number | null;
  delivery_split_collector_pct?: number | null;
  self_delivery?: boolean;
  delivery_person_id?: string | null;
  delivery_person_name?: string | null;
  collector_id?: string | null;
  collector_name?: string | null;
  collector_status?: CollectorStatus;
  /** True while the collector's float is held and not yet settled/released. */
  hold_held?: boolean;
  cod_expected_cash?: number | null;
  cod_actual_cash?: number | null;
  cod_cash_received_at?: string | null;
  cod_discrepancy?: boolean;
  cod_settled_at?: string | null;
  cod_settlement_kind?: string | null;
  seller_amount?: number | null;
  cashback_amount?: number | null;
  delivery_share_amount?: number | null;
  collector_share_amount?: number | null;
  chat_thread_id?: string | null;
}

/** Cash the customer hands over for a COD order: product total + delivery fee. Nothing else. */
export const codCashTotal = (o: Pick<RetailOrder, "total" | "delivery_fee">) =>
  round2(o.total + (o.delivery_fee ?? 0));

/* ------------------------------------------------------------------ */
/* Pricing — presentation mirror of the database's authoritative path   */
/* ------------------------------------------------------------------ */
/*
 * The database (`retail_place_order`) is the only place that decides what an
 * order costs. The helpers below repeat the same arithmetic, in the same
 * order, so what the buyer sees before confirming equals what the ledger
 * holds:
 *   1. applicable seller unit price — the shop's single wholesale tier once the
 *      quantity reaches `wholesale_min_qty`, otherwise the regular price
 *   2. seller line = round2(unit × qty)
 *   3. fee line    = round2(seller line × fee% / 100)   ← discounted base only
 *   4. customer line = seller line + fee line
 * Order totals are sums of the rounded lines, never re-rounded.
 */

export type Cart = Record<string, number>;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** True when this quantity earns the product's wholesale price. */
export function wholesaleApplies(
  product: Pick<RetailProduct, "wholesale_price" | "wholesale_min_qty">,
  quantity: number,
): boolean {
  const wp = Number(product.wholesale_price ?? 0);
  const min = Number(product.wholesale_min_qty ?? 0);
  return wp > 0 && min > 0 && quantity >= min;
}

/** Seller unit amount actually charged for this quantity. */
export function applicableUnitPrice(
  product: Pick<RetailProduct, "price" | "wholesale_price" | "wholesale_min_qty">,
  quantity: number,
): number {
  return wholesaleApplies(product, quantity) ? Number(product.wholesale_price) : product.price;
}

/** Customer price for one unit at the seller amount `seller` (display only). */
export const sellerToCustomer = (seller: number, feePercent: number) =>
  round2(seller + round2((seller * feePercent) / 100));

/** Seller amount that yields (as closely as 2 dp allows) the customer price. */
export const customerToSeller = (customer: number, feePercent: number) =>
  round2(customer / (1 + feePercent / 100));

export interface LineQuote {
  unitPrice: number;
  wholesale: boolean;
  sellerTotal: number;
  fee: number;
  customerTotal: number;
}

export function quoteLine(
  product: Pick<RetailProduct, "price" | "wholesale_price" | "wholesale_min_qty">,
  quantity: number,
  feePercent: number,
): LineQuote {
  const unitPrice = applicableUnitPrice(product, quantity);
  const sellerTotal = round2(unitPrice * quantity);
  const fee = round2((sellerTotal * feePercent) / 100);
  return {
    unitPrice,
    wholesale: wholesaleApplies(product, quantity),
    sellerTotal,
    fee,
    customerTotal: round2(sellerTotal + fee),
  };
}

export interface CartLine extends LineQuote {
  product: RetailProduct;
  quantity: number;
  /** Customer line total — what the wallet is charged for this line. */
  lineTotal: number;
}

export function cartLines(cart: Cart, products: RetailProduct[], feePercent = 0): CartLine[] {
  return products
    .filter((p) => (cart[p.id] ?? 0) > 0)
    .map((product) => {
      const quantity = cart[product.id] ?? 0;
      const q = quoteLine(product, quantity, feePercent);
      return { product, quantity, ...q, lineTotal: q.customerTotal };
    });
}

export const cartCount = (cart: Cart) =>
  Object.values(cart).reduce((sum, q) => sum + (q > 0 ? q : 0), 0);

export interface CartQuote {
  sellerTotal: number;
  fee: number;
  total: number;
}

export function cartQuote(cart: Cart, products: RetailProduct[], feePercent = 0): CartQuote {
  const lines = cartLines(cart, products, feePercent);
  return {
    sellerTotal: round2(lines.reduce((s, l) => s + l.sellerTotal, 0)),
    fee: round2(lines.reduce((s, l) => s + l.fee, 0)),
    total: round2(lines.reduce((s, l) => s + l.customerTotal, 0)),
  };
}

/** Customer total the wallet is charged. */
export const cartTotal = (cart: Cart, products: RetailProduct[], feePercent = 0) =>
  cartQuote(cart, products, feePercent).total;

/** Current platform fee percentage (read-only; changing it needs the platform owner). */
export async function fetchRetailFeePercent(): Promise<number> {
  const { data, error } = await supabase.rpc("retail_platform_fee_percent");
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Adds `delta` of a product while never exceeding its remaining stock. */
export function changeQuantity(cart: Cart, product: RetailProduct, delta: number): Cart {
  const next = Math.max(0, Math.min(product.stock, (cart[product.id] ?? 0) + delta));
  const copy = { ...cart };
  if (next === 0) delete copy[product.id];
  else copy[product.id] = next;
  return copy;
}

export interface CheckoutDraft {
  fulfillment: Fulfillment | null;
  payment: PaymentMethod | null;
  address: string;
  notes: string;
}

/** Server-side COD eligibility answer (`retail_cod_quote`). */
export interface CodQuote {
  available: boolean;
  reason: string | null;
  /** Seller-set flat delivery fee — never carries a platform fee. */
  deliveryFee: number;
  /** Seller-side requirement: the fee already embedded in the product price. */
  platformFee: number;
  /** Cash the customer pays: product retail total + delivery fee. */
  customerTotal: number;
}

/**
 * Presentation mirror of the customer-facing COD amount: the product retail
 * total (fee already inside) plus the delivery fee. The 1 % is never applied
 * to the delivery fee and never applied a second time to the retail price.
 */
export const codCustomerTotal = (productTotal: number, deliveryFee: number) =>
  round2(productTotal + deliveryFee);

/** Human reason the order cannot be submitted yet, or null when it can. */
export function checkoutProblem(
  draft: CheckoutDraft,
  total: number,
  settings: StoreSettings,
  creditBalance: number,
  itemCount: number,
  codQuote?: CodQuote | null,
): string | null {
  if (itemCount === 0) return "Your cart is empty";
  if (!settings.acceptingOrders) return "This shop is temporarily closed for new orders";
  if (!draft.fulfillment) return "Choose pickup or delivery";
  if (draft.fulfillment === "pickup" && !settings.pickupEnabled)
    return "This shop does not offer pickup";
  if (draft.fulfillment === "delivery") {
    if (!settings.deliveryEnabled) return "This shop does not offer delivery";
    if (!draft.address.trim()) return "A delivery address is required";
  }
  if (!draft.payment) return "Choose a payment method";
  if (draft.payment === "cash" && !settings.cashEnabled) return "This shop does not accept cash";
  if (draft.payment === "credit") {
    if (!settings.creditEnabled) return "This shop does not accept coin payment";
    if (total > creditBalance) return "Not enough coins in your wallet";
  }
  if (draft.payment === "cod") {
    if (draft.fulfillment !== "delivery") return "Cash on delivery requires delivery";
    if (!settings.codEnabled) return "This shop does not offer cash on delivery";
    if (!codQuote) return "Checking cash-on-delivery availability…";
    if (!codQuote.available)
      return codQuote.reason ?? "Cash on delivery is not available right now";
  }
  return null;
}

export const orderTone = (s: OrderStatus) =>
  s === "approved"
    ? "success"
    : s === "pending"
      ? "warning"
      : s === "rejected"
        ? "danger"
        : "muted";

/* ------------------------------------------------------------------ */
/* Fulfillment (R5) — mirrors public.retail_fulfillment_step_ok         */
/* ------------------------------------------------------------------ */

/** The single legal next step for a seller, or null when there is none. */
export function nextFulfillmentStep(
  current: FulfillmentStatus,
  fulfillment: Fulfillment,
): FulfillmentStatus | null {
  switch (current) {
    case "accepted":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return fulfillment === "delivery" ? "out_for_delivery" : "delivered";
    case "out_for_delivery":
      return "delivered";
    default:
      return null;
  }
}

/** True when the customer may confirm receipt. */
export const canConfirmReceipt = (o: Pick<RetailOrder, "status" | "fulfillment_status">) =>
  o.status === "approved" && o.fulfillment_status === "delivered";

/** True when the customer may still cancel (existing rule: only while pending). */
export const canCancelOrder = (o: Pick<RetailOrder, "status">) => o.status === "pending";

export const fulfillmentLabel = (s: FulfillmentStatus, fulfillment: Fulfillment): string =>
  ({
    awaiting: "Awaiting shop review",
    accepted: "Accepted",
    preparing: "Preparing",
    ready: fulfillment === "pickup" ? "Ready for pickup" : "Ready to go out",
    out_for_delivery: "Out for delivery",
    delivered: fulfillment === "pickup" ? "Handed over" : "Delivered",
    completed: "Completed",
    closed: "Closed",
  })[s];

/** Seller-facing label for the button that advances to `next`. */
export const fulfillmentActionLabel = (next: FulfillmentStatus, fulfillment: Fulfillment): string =>
  ({
    awaiting: "",
    accepted: "",
    preparing: "Start preparing",
    ready: fulfillment === "pickup" ? "Mark ready for pickup" : "Mark ready",
    out_for_delivery: "Out for delivery",
    delivered: fulfillment === "pickup" ? "Handed to customer" : "Mark delivered",
    completed: "",
    closed: "",
  })[next];

export const fulfillmentTone = (o: Pick<RetailOrder, "status" | "fulfillment_status">) =>
  o.status === "rejected"
    ? "danger"
    : o.status === "cancelled" || o.fulfillment_status === "closed"
      ? "muted"
      : o.fulfillment_status === "completed"
        ? "success"
        : o.fulfillment_status === "awaiting"
          ? "warning"
          : "brand";

/** Why the customer can no longer cancel, or null while cancelling is still allowed. */
export function customerCancelBlockedReason(
  o: Pick<RetailOrder, "status" | "fulfillment_status">,
): string | null {
  if (o.status === "pending") return null;
  if (o.status !== "approved") return null;
  if (["out_for_delivery", "delivered", "completed"].includes(o.fulfillment_status))
    return "This order was already handed to the delivery person and can no longer be cancelled.";
  return "The shop accepted this order — ask the seller in the order chat if you need to cancel.";
}

/** What the customer should understand / do right now. */
export function customerNextStep(
  o: Pick<RetailOrder, "status" | "fulfillment_status" | "fulfillment" | "payment_method">,
): string {
  if (o.status === "pending")
    return o.payment_method === "credit"
      ? "Waiting for the shop to review. Your coins are held and returned in full if it is rejected. You can still cancel."
      : o.payment_method === "cod"
        ? "Waiting for the shop to review. You pay cash on delivery — no coins are taken from your wallet. You can still cancel."
        : "Waiting for the shop to review. Pay in cash when you receive it. You can still cancel.";
  if (o.status === "rejected") return "The shop rejected this order. Nothing was charged.";
  if (o.status === "cancelled") return "You cancelled this order. Nothing was charged.";
  switch (o.fulfillment_status) {
    case "accepted":
      return "The shop accepted your order and will start preparing it.";
    case "preparing":
      return "The shop is preparing your order.";
    case "ready":
      return o.fulfillment === "pickup"
        ? "Your order is ready — visit the shop to pick it up."
        : "Your order is packed and will go out soon.";
    case "out_for_delivery":
      return "Your order is on its way to your address.";
    case "delivered":
      return "The shop marked this order as handed over. Confirm you received it.";
    case "completed":
      return "Order complete. You can rate the products.";
    default:
      return "Order accepted.";
  }
}

/** Which store tabs a shop shows, given its settings. */
export function enabledStores(s: StoreSettings): Array<"voucher" | "retail"> {
  return [
    ...(s.voucherEnabled ? (["voucher"] as const) : []),
    ...(s.retailEnabled ? (["retail"] as const) : []),
  ];
}

/* ------------------------------------------------------------------ */
/* Store settings                                                      */
/* ------------------------------------------------------------------ */

export async function fetchStoreSettings(ecosystemId: string): Promise<StoreSettings> {
  const { data, error } = await supabase.rpc("shop_store_settings", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return DEFAULT_STORE_SETTINGS;
  return {
    voucherEnabled: !!row["voucher_enabled"],
    retailEnabled: !!row["retail_enabled"],
    cashEnabled: !!row["cash_enabled"],
    creditEnabled: !!row["credit_enabled"],
    pickupEnabled: !!row["pickup_enabled"],
    deliveryEnabled: !!row["delivery_enabled"],
    publicStorefront: !!row["public_storefront"],
    contactEmail: (row["contact_email"] as string | null) ?? null,
    codEnabled: !!row["cod_enabled"],
    deliveryFee: Number(row["delivery_fee"] ?? 0),
    deliveryPct: Number(row["delivery_pct"] ?? 0),
    collectorPct: Number(row["collector_pct"] ?? 0),
    logoPath: (row["logo_path"] as string | null) ?? null,
    coverPath: (row["cover_path"] as string | null) ?? null,
    acceptingOrders: row["accepting_orders"] === undefined ? true : !!row["accepting_orders"],
    pausedNote: (row["paused_note"] as string | null) ?? null,
    theme: (["fresh", "warm"].includes(String(row["theme"])) ? row["theme"] : "clear") as StoreSettings["theme"],
  };
}

/* ------------------------------------------------------------------ */
/* Storefront identity (logo, cover, open/paused)                      */
/* ------------------------------------------------------------------ */

export type StorefrontSettings = Pick<
  StoreSettings,
  "logoPath" | "coverPath" | "acceptingOrders" | "pausedNote" | "theme"
>;

export const STOREFRONT_NOTE_MAX = 160;

/** Client-side validation mirroring the database check. */
export function storefrontProblem(s: Pick<StorefrontSettings, "pausedNote">): string | null {
  if ((s.pausedNote ?? "").length > STOREFRONT_NOTE_MAX)
    return `Keep the note under ${STOREFRONT_NOTE_MAX} characters.`;
  return null;
}

/** Square logo — small and crisp; cover uses the existing 16:10 card target. */
export const STOREFRONT_LOGO_TARGET: ImageTarget = {
  width: 320,
  height: 320,
  quality: 0.85,
  maxBytes: 150 * 1024,
};

/**
 * Uploads a shop logo or cover into the shop's own `storefront/` folder of the
 * existing retail-images bucket (storage RLS: shop admin only).
 */
export async function uploadStorefrontImage(
  ecosystemId: string,
  kind: "logo" | "cover",
  file: File,
): Promise<string> {
  const problem = validateImageFile(file);
  if (problem) throw new Error(problem);
  const source = await loadImage(file);
  const { blob, mime } = await optimizeImage(
    source,
    kind === "logo" ? STOREFRONT_LOGO_TARGET : REWARD_TARGET,
  );
  const path = `${ecosystemId}/storefront/${optimizedName(`${kind}-${crypto.randomUUID()}`, mime)}`;
  const { error } = await supabase.storage
    .from(RETAIL_IMAGE_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Saves storefront identity through `update_retail_storefront` (server re-checks the shop admin). */
export async function saveStorefrontSettings(
  ecosystemId: string,
  s: StorefrontSettings,
  previous?: Pick<StorefrontSettings, "logoPath" | "coverPath">,
): Promise<void> {
  const problem = storefrontProblem(s);
  if (problem) throw new Error(problem);
  const { error } = await supabase.rpc("update_retail_storefront", {
    _ecosystem_id: ecosystemId,
    ...(s.logoPath ? { _logo_path: s.logoPath } : {}),
    ...(s.coverPath ? { _cover_path: s.coverPath } : {}),
    _accepting_orders: s.acceptingOrders,
    _paused_note: s.pausedNote ?? "",
    _clear_logo: !s.logoPath,
    _clear_cover: !s.coverPath,
    _theme: s.theme,
  });
  if (error) throw new Error(error.message);
  // Replaced or removed images are deleted so storage does not grow.
  const stale = [previous?.logoPath, previous?.coverPath].filter(
    (p): p is string => !!p && p !== s.logoPath && p !== s.coverPath && p.includes("/storefront/"),
  );
  if (stale.length) await supabase.storage.from(RETAIL_IMAGE_BUCKET).remove(stale);
}

/**
 * R6 — cash-on-delivery configuration (shop admin only). The split must total
 * exactly 100 %; the database re-checks it and snapshots the values onto each
 * order at placement, so later changes never alter a historical order.
 */
export async function saveDeliverySettings(
  ecosystemId: string,
  s: Pick<StoreSettings, "codEnabled" | "deliveryFee" | "deliveryPct" | "collectorPct">,
): Promise<void> {
  const { error } = await supabase.rpc("update_retail_delivery_settings", {
    _ecosystem_id: ecosystemId,
    _cod_enabled: s.codEnabled,
    _delivery_fee: s.deliveryFee,
    _delivery_pct: s.deliveryPct,
    _collector_pct: s.collectorPct,
  });
  if (error) throw new Error(error.message);
}

/**
 * Saves which stores this shop offers.
 *
 * Goes through `update_store_settings`, which re-checks server-side that the
 * caller really administers this shop (a direct table write is blocked by the
 * tenant policies, which is why saving silently did nothing before). Turning
 * the retail store on for the very first time also loads the shared Philippine
 * sari-sari starter catalog into this shop as unpublished drafts.
 */
export async function saveStoreSettings(
  ecosystemId: string,
  s: Omit<StoreSettings, "contactEmail" | keyof StorefrontSettings>,
): Promise<{ seeded: number }> {
  const { data, error } = await supabase.rpc("update_store_settings", {
    _ecosystem_id: ecosystemId,
    _voucher_enabled: s.voucherEnabled,
    _retail_enabled: s.retailEnabled,
    _cash_enabled: s.cashEnabled,
    _credit_enabled: s.creditEnabled,
    _pickup_enabled: s.pickupEnabled,
    _delivery_enabled: s.deliveryEnabled,
    _public_storefront: s.publicStorefront,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ seeded?: number }> | null)?.[0];
  return { seeded: Number(row?.seeded ?? 0) };
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

/**
 * Buyer-facing listing. The database returns only customer-safe columns —
 * the wholesale price and minimum quantity are customer-facing (bulk buying);
 * SKU and barcode stay in the admin view.
 */
export async function fetchRetailProducts(ecosystemId: string): Promise<RetailProduct[]> {
  const { data, error } = await supabase.rpc("list_retail_products", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RetailProduct[]).map((p) => ({
    ...p,
    price: Number(p.price),
    wholesale_price: Number(p.wholesale_price ?? 0),
    wholesale_min_qty: Number(p.wholesale_min_qty ?? 0),
  }));
}

/** Retail cashback per product: an EARNING for the attributed seller, never a price cut. */
export type RetailCashbackMode = "disabled" | "percent" | "fixed";

/**
 * Presentation mirror of the database `retail_line_cashback`: the base is the
 * ACTUAL seller amount paid for the line (wholesale price when it applies);
 * fixed is per unit; both are capped at the line so cashback never exceeds it.
 */
export const lineCashback = (
  mode: RetailCashbackMode,
  value: number,
  sellerLine: number,
  qty: number,
): number => {
  const line = Math.round(sellerLine * 100) / 100;
  if (mode === "percent") return Math.min(Math.round(line * value) / 100, line);
  if (mode === "fixed") return Math.min(Math.round(value * qty * 100) / 100, line);
  return 0;
};

/** Catalog metadata shared by starter-catalog and manually added products. */
export interface RetailProductDetails {
  category: string | null;
  brand: string | null;
  variant: string | null;
  size_label: string | null;
  unit: string;
  wholesale_price: number;
  /** Smallest quantity that earns the wholesale price; 0 means retail only. */
  wholesale_min_qty: number;
  sku: string | null;
  barcode: string | null;
  /** "Ready to go live": only published products reach customers. */
  published: boolean;
  /** Set when the row came from the shared starter catalog. */
  template_id: string | null;
  cashback_mode: RetailCashbackMode;
  /** Percent of the amount paid, or coins per unit, depending on the mode. */
  cashback_value: number;
}

export interface RetailProductRow
  extends Omit<RetailProduct, keyof RetailProductDetails>, RetailProductDetails {
  active: boolean;
  archived: boolean;
}

/** Admin view: includes unpublished, hidden and archived products. */
export async function fetchAllRetailProducts(ecosystemId: string): Promise<RetailProductRow[]> {
  const { data, error } = await supabase
    .from("retail_products")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("archived")
    .order("category", { nullsFirst: false })
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RetailProductRow[]).map((p) => ({
    ...p,
    price: Number(p.price),
    wholesale_price: Number(p.wholesale_price ?? 0),
    wholesale_min_qty: Number(p.wholesale_min_qty ?? 0),
    cashback_mode: (p.cashback_mode ?? "disabled") as RetailCashbackMode,
    cashback_value: Number(p.cashback_value ?? 0),
    rating_avg: 0,
    rating_count: 0,
  }));
}

/** Loads any missing starter-catalog products into this shop, unpublished. */
export async function loadStarterCatalog(ecosystemId: string): Promise<number> {
  requireOnline();
  const { data, error } = await supabase.rpc("seed_retail_catalog", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface RetailProductInput extends Partial<RetailProductDetails> {
  id?: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image_path: string | null;
  public_visible: boolean;
  active: boolean;
}

const trimmed = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export async function saveRetailProduct(
  ecosystemId: string,
  input: RetailProductInput,
): Promise<void> {
  const payload = {
    ecosystem_id: ecosystemId,
    name: input.name.trim(),
    description: input.description.trim() || null,
    price: input.price,
    stock: Math.max(0, Math.round(input.stock)),
    image_path: input.image_path,
    public_visible: input.public_visible,
    active: input.active,
    category: trimmed(input.category),
    brand: trimmed(input.brand),
    variant: trimmed(input.variant),
    size_label: trimmed(input.size_label),
    unit: trimmed(input.unit) ?? "piece",
    wholesale_price: Math.max(0, input.wholesale_price ?? 0),
    wholesale_min_qty: Math.max(0, Math.round(input.wholesale_min_qty ?? 0)),
    sku: trimmed(input.sku),
    barcode: trimmed(input.barcode),
    published: input.published ?? false,
    cashback_mode: input.cashback_mode ?? "disabled",
    cashback_value:
      input.cashback_mode === "percent"
        ? Math.min(100, Math.max(0, input.cashback_value ?? 0))
        : Math.max(0, input.cashback_value ?? 0),
  };
  const { error } = input.id
    ? await supabase.from("retail_products").update(payload).eq("id", input.id)
    : await supabase.from("retail_products").insert(payload);
  if (error) throw new Error(error.message);
}

/** Publishing is the only step that makes a product visible to customers. */
export async function setRetailProductPublished(id: string, published: boolean): Promise<void> {
  const { error } = await supabase.from("retail_products").update({ published }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Archiving hides a product without deleting it or any past order. */
export async function setRetailProductArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from("retail_products")
    .update({ archived, ...(archived ? { active: false, published: false } : {}) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Admin catalog filtering — pure so it can be asserted in tests        */
/* ------------------------------------------------------------------ */

export type CatalogStatusFilter = "all" | "published" | "draft" | "archived";
export type CatalogSourceFilter = "all" | "catalog" | "manual";

export interface CatalogFilter {
  search: string;
  category: string;
  status: CatalogStatusFilter;
  source: CatalogSourceFilter;
}

export const EMPTY_CATALOG_FILTER: CatalogFilter = {
  search: "",
  category: "all",
  status: "all",
  source: "all",
};

/** Distinct categories present in a shop's own product listing. */
export function productCategories(rows: RetailProductRow[]): string[] {
  return [...new Set(rows.map((r) => r.category ?? "Uncategorised"))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function isProductReady(row: RetailProductRow): boolean {
  return row.price > 0 && row.stock > 0;
}

export function filterProducts(rows: RetailProductRow[], f: CatalogFilter): RetailProductRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status === "archived" ? !r.archived : r.archived && f.status !== "all") return false;
    if (f.status === "published" && !r.published) return false;
    if (f.status === "draft" && r.published) return false;
    if (f.category !== "all" && (r.category ?? "Uncategorised") !== f.category) return false;
    if (f.source === "catalog" && !r.template_id) return false;
    if (f.source === "manual" && r.template_id) return false;
    if (!q) return true;
    return [r.name, r.brand, r.variant, r.size_label, r.category, r.sku, r.barcode]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
}

export function validateRetailImage(file: File): string | null {
  return validateImageFile(file);
}

export async function uploadRetailImage(
  ecosystemId: string,
  file: File,
  crop?: CropRect,
  preloaded?: HTMLImageElement,
): Promise<string> {
  const problem = validateRetailImage(file);
  if (problem) throw new Error(problem);
  const source = preloaded ?? (await loadImage(file));
  const { blob, mime } = await optimizeImage(source, REWARD_TARGET, crop);
  const path = `${ecosystemId}/${optimizedName(crypto.randomUUID(), mime)}`;
  const { error } = await supabase.storage
    .from(RETAIL_IMAGE_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

const urlCache = new Map<string, { url: string; expires: number }>();

export async function retailImageUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  // Shared starter-catalog photos ship with the app, so they need no signing
  // and stay available even when a shop has never uploaded anything itself.
  if (path.startsWith("catalog/")) return `/${path}`;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage
    .from(RETAIL_IMAGE_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export interface PlacedOrder {
  orderId: string;
  orderNo: string;
  total: number;
}

export async function placeRetailOrder(
  ecosystemId: string,
  cart: Cart,
  draft: CheckoutDraft,
  /** Universe storefront the buyer purchased through (authorized seller); cashback attribution. */
  sellerId?: string | null,
  /** Per-checkout-attempt id: a retry with the same ref returns the same order (no duplicate). */
  clientRef?: string | null,
): Promise<PlacedOrder> {
  requireOnline();
  const items = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([product_id, quantity]) => ({ product_id, quantity }));
  const { data, error } = await supabase.rpc("retail_place_order", {
    _ecosystem_id: ecosystemId,
    _items: items,
    _fulfillment: draft.fulfillment ?? "pickup",
    _payment_method: draft.payment ?? "cash",
    ...(draft.address.trim() ? { _address: draft.address.trim() } : {}),
    ...(draft.notes.trim() ? { _notes: draft.notes.trim() } : {}),
    ...(sellerId ? { _seller_id: sellerId } : {}),
    ...(clientRef ? { _client_ref: clientRef } : {}),
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  return {
    orderId: String(row?.["order_id"] ?? ""),
    orderNo: String(row?.["order_no"] ?? ""),
    total: Number(row?.["total"] ?? 0),
  };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const toOrders = (data: unknown): RetailOrder[] =>
  ((data ?? []) as RetailOrder[]).map((o) => ({
    ...o,
    total: Number(o.total),
    seller_total: Number(o.seller_total ?? o.total),
    platform_fee_percent: Number(o.platform_fee_percent ?? 0),
    platform_fee_amount: Number(o.platform_fee_amount ?? 0),
    delivery_fee: Number(o.delivery_fee ?? 0),
    collector_status: (o.collector_status ?? "none") as CollectorStatus,
    hold_held: !!o.hold_held,
    cod_discrepancy: !!o.cod_discrepancy,
    self_delivery: !!o.self_delivery,
    cod_expected_cash: num(o.cod_expected_cash),
    cod_actual_cash: num(o.cod_actual_cash),
    seller_amount: num(o.seller_amount),
    cashback_amount: num(o.cashback_amount),
    delivery_share_amount: num(o.delivery_share_amount),
    collector_share_amount: num(o.collector_share_amount),
    fulfillment_status: (o.fulfillment_status ??
      (o.status === "approved"
        ? "accepted"
        : o.status === "pending"
          ? "awaiting"
          : "closed")) as FulfillmentStatus,
    items: (o.items ?? []).map((i) => ({
      ...i,
      unit_price: Number(i.unit_price),
      line_total: Number(i.line_total),
      regular_unit_price: Number(i.regular_unit_price ?? i.unit_price),
      wholesale_applied: !!i.wholesale_applied,
      seller_line_total: Number(i.seller_line_total ?? i.line_total),
      fee_amount: Number(i.fee_amount ?? 0),
    })),
  }));

export async function fetchMyRetailOrders(ecosystemId: string): Promise<RetailOrder[]> {
  const { data, error } = await supabase.rpc("my_retail_orders", { _ecosystem_id: ecosystemId });
  if (error) throw new Error(error.message);
  return toOrders(data);
}

export async function fetchShopRetailOrders(
  ecosystemId: string,
  status?: OrderStatus | "all",
): Promise<RetailOrder[]> {
  const { data, error } = await supabase.rpc("list_retail_orders", {
    _ecosystem_id: ecosystemId,
    ...(status ? { _status: status } : {}),
  });
  if (error) throw new Error(error.message);
  return toOrders(data);
}

export async function reviewRetailOrder(
  orderId: string,
  approve: boolean,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("retail_review_order", {
    _order_id: orderId,
    _approve: approve,
    ...(note?.trim() ? { _note: note.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function updateRetailFulfillment(
  orderId: string,
  next: FulfillmentStatus,
): Promise<void> {
  const { error } = await supabase.rpc("retail_update_fulfillment", {
    _order_id: orderId,
    _next: next,
  });
  if (error) throw new Error(error.message);
}

export async function cancelRetailOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_retail_order", { _order_id: orderId });
  if (error) throw new Error(error.message);
}

export async function rateRetailProduct(
  orderId: string,
  productId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  const { error } = await supabase.rpc("rate_retail_product", {
    _order_id: orderId,
    _product_id: productId,
    _rating: rating,
    ...(comment?.trim() ? { _comment: comment.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Seller workspace — operational stages (presentation over the R5/R6  */
/* state machine; never a second status)                                */
/* ------------------------------------------------------------------ */

export type OrderStage =
  "new" | "preparing" | "ready" | "in_delivery" | "delivered" | "completed" | "closed";

export const ORDER_STAGES: { id: OrderStage; label: string; hint: string }[] = [
  { id: "new", label: "New", hint: "Approve or reject" },
  { id: "preparing", label: "To prepare", hint: "Accepted, not yet ready" },
  { id: "ready", label: "Ready", hint: "Packed — assign & hand off" },
  { id: "in_delivery", label: "In delivery", hint: "Out with the delivery person" },
  { id: "delivered", label: "Delivered", hint: "Waiting for buyer / cash / settlement" },
  { id: "completed", label: "Completed", hint: "Done and settled" },
  { id: "closed", label: "Cancelled", hint: "Rejected or cancelled" },
];

/** Which workspace tab an order belongs to. Derived only from existing fields. */
export function orderStage(
  o: Pick<
    RetailOrder,
    "status" | "fulfillment_status" | "payment_method" | "cod_settled_at" | "hold_held"
  >,
): OrderStage {
  if (o.status === "pending") return "new";
  if (o.status === "rejected" || o.status === "cancelled") return "closed";
  switch (o.fulfillment_status) {
    case "awaiting":
    case "accepted":
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "out_for_delivery":
      return "in_delivery";
    case "delivered":
      return "delivered";
    case "completed":
      // A COD order is only truly done once its float has been settled.
      return o.payment_method === "cod" && !o.cod_settled_at ? "delivered" : "completed";
    default:
      return "closed";
  }
}

export const countByStage = (orders: RetailOrder[]): Record<OrderStage, number> => {
  const c = {
    new: 0,
    preparing: 0,
    ready: 0,
    in_delivery: 0,
    delivered: 0,
    completed: 0,
    closed: 0,
  };
  for (const o of orders) c[orderStage(o)] += 1;
  return c;
};

/** Status history from the timestamps the order already carries (no new table). */
export function orderTimeline(
  o: Pick<
    RetailOrder,
    | "created_at"
    | "status"
    | "delivered_at"
    | "completed_at"
    | "cod_cash_received_at"
    | "cod_settled_at"
    | "fulfillment"
    | "payment_method"
  >,
): { label: string; at: string }[] {
  const t: { label: string; at: string }[] = [{ label: "Order placed", at: o.created_at }];
  if (o.delivered_at)
    t.push({
      label: o.fulfillment === "pickup" ? "Handed to customer" : "Delivered",
      at: o.delivered_at,
    });
  if (o.completed_at) t.push({ label: "Buyer confirmed receipt", at: o.completed_at });
  if (o.payment_method === "cod" && o.cod_cash_received_at)
    t.push({ label: "Collector confirmed cash", at: o.cod_cash_received_at });
  if (o.payment_method === "cod" && o.cod_settled_at)
    t.push({ label: "Settled", at: o.cod_settled_at });
  return t.sort((a, b) => a.at.localeCompare(b.at));
}

/** Orders waiting for the seller's approval — feeds the console nav badge. */
export async function fetchPendingRetailOrderCount(ecosystemId: string): Promise<number> {
  const orders = await fetchShopRetailOrders(ecosystemId, "pending");
  return orders.length;
}

/* ------------------------------------------------------------------ */
/* Customer order history — presentation over the same R5/R6 state     */
/* machine. Nothing here reads or exposes the seller/platform split.    */
/* ------------------------------------------------------------------ */

export type CustomerStage = "active" | "completed" | "cancelled";

export const CUSTOMER_STAGES: { id: CustomerStage; label: string; hint: string }[] = [
  { id: "active", label: "Active", hint: "Being reviewed, prepared or delivered" },
  { id: "completed", label: "Completed", hint: "Received and closed" },
  { id: "cancelled", label: "Cancelled", hint: "Rejected or cancelled — nothing was charged" },
];

/** Which history tab an order belongs to, from existing fields only. */
export function customerStage(
  o: Pick<RetailOrder, "status" | "fulfillment_status">,
): CustomerStage {
  if (o.status === "rejected" || o.status === "cancelled") return "cancelled";
  if (o.status === "approved" && o.fulfillment_status === "completed") return "completed";
  if (o.status === "approved" && o.fulfillment_status === "closed") return "cancelled";
  return "active";
}

export const countByCustomerStage = (orders: RetailOrder[]): Record<CustomerStage, number> => {
  const c = { active: 0, completed: 0, cancelled: 0 };
  for (const o of orders) c[customerStage(o)] += 1;
  return c;
};

export interface TrackingStep {
  label: string;
  done: boolean;
  current: boolean;
}

const FULFILLMENT_ORDER: FulfillmentStatus[] = [
  "awaiting",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "completed",
];

/**
 * Customer tracking steps: placed → accepted → preparing → ready →
 * (out for delivery) → delivered/handed over → received. Only R5/R6 states;
 * settlement is internal and never shown to the buyer.
 */
export function customerTrackingSteps(
  o: Pick<RetailOrder, "status" | "fulfillment_status" | "fulfillment">,
): TrackingStep[] {
  const delivery = o.fulfillment === "delivery";
  const labels: { s: FulfillmentStatus; label: string }[] = [
    { s: "awaiting", label: "Order placed" },
    { s: "accepted", label: "Accepted" },
    { s: "preparing", label: "Preparing" },
    { s: "ready", label: delivery ? "Ready to go out" : "Ready for pickup" },
    ...(delivery ? [{ s: "out_for_delivery" as const, label: "Out for delivery" }] : []),
    { s: "delivered", label: delivery ? "Delivered" : "Handed over" },
    { s: "completed", label: "Received" },
  ];
  const reached =
    o.status === "pending"
      ? 0
      : o.status !== "approved"
        ? -1
        : FULFILLMENT_ORDER.indexOf(o.fulfillment_status);
  return labels.map((l) => {
    const idx = FULFILLMENT_ORDER.indexOf(l.s);
    return { label: l.label, done: reached >= idx, current: reached === idx };
  });
}

/** The order chat exists for delivery orders that are still alive (server rule mirrored). */
export const canOpenOrderChat = (o: Pick<RetailOrder, "status" | "fulfillment">) =>
  o.fulfillment === "delivery" && (o.status === "pending" || o.status === "approved");

/**
 * What the customer pays: Retail Prices (fee already embedded) + delivery fee.
 * `delivery` is 0 unless the shop charged one (COD); it is never inside the 1%.
 */
export function customerOrderTotals(
  o: Pick<RetailOrder, "total" | "delivery_fee" | "fulfillment">,
): { products: number; delivery: number; total: number } {
  const delivery = o.fulfillment === "delivery" ? round2(o.delivery_fee ?? 0) : 0;
  return { products: round2(o.total), delivery, total: round2(o.total + delivery) };
}

/** Customer-safe payment status line. */
export function customerPaymentLabel(
  o: Pick<RetailOrder, "payment_method" | "status" | "fulfillment_status" | "cod_settled_at">,
): string {
  if (o.status === "rejected" || o.status === "cancelled") return "Nothing charged";
  if (o.payment_method === "credit")
    return o.status === "pending" ? "Coins held (refunded if rejected)" : "Paid with coins";
  if (o.payment_method === "cod")
    return o.cod_settled_at || o.fulfillment_status === "completed"
      ? "Cash paid on delivery"
      : "Pay cash on delivery";
  return o.fulfillment_status === "completed" ? "Paid in cash" : "Pay in cash";
}
