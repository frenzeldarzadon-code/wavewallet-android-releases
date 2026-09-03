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
} from "@/lib/image-optimize";

export const RETAIL_IMAGE_BUCKET = "retail-images";
export const MAX_RETAIL_IMAGE_BYTES = MAX_UPLOAD_BYTES;

export type Fulfillment = "pickup" | "delivery";
export type PaymentMethod = "cash" | "credit";
export type OrderStatus = "pending" | "approved" | "rejected" | "cancelled";

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
  delivery_address: string | null;
  delivery_notes: string | null;
  payment_method: PaymentMethod;
  /** Customer amount consumed (seller total + platform fee). */
  total: number;
  seller_total?: number;
  platform_fee_percent?: number;
  platform_fee_amount?: number;
  decision_note: string | null;
  created_at: string;
  items: OrderItem[];
}

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

/** Human reason the order cannot be submitted yet, or null when it can. */
export function checkoutProblem(
  draft: CheckoutDraft,
  total: number,
  settings: StoreSettings,
  creditBalance: number,
  itemCount: number,
): string | null {
  if (itemCount === 0) return "Your cart is empty";
  if (!draft.fulfillment) return "Choose pickup or delivery";
  if (draft.fulfillment === "pickup" && !settings.pickupEnabled)
    return "This shop does not offer pickup";
  if (draft.fulfillment === "delivery") {
    if (!settings.deliveryEnabled) return "This shop does not offer delivery";
    if (!draft.address.trim()) return "A delivery address is required";
  }
  if (!draft.payment) return "Choose a payment method";
  if (draft.payment === "cash" && !settings.cashEnabled)
    return "This shop does not accept cash";
  if (draft.payment === "credit") {
    if (!settings.creditEnabled) return "This shop does not accept coin payment";
    if (total > creditBalance) return "Not enough coins in your wallet";
  }
  return null;
}

export const orderTone = (s: OrderStatus) =>
  s === "approved" ? "success" : s === "pending" ? "warning" : s === "rejected" ? "danger" : "muted";

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
  };
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
  s: Omit<StoreSettings, "contactEmail">,
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
  extends Omit<RetailProduct, keyof RetailProductDetails>,
    RetailProductDetails {
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
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  return {
    orderId: String(row?.["order_id"] ?? ""),
    orderNo: String(row?.["order_no"] ?? ""),
    total: Number(row?.["total"] ?? 0),
  };
}

const toOrders = (data: unknown): RetailOrder[] =>
  ((data ?? []) as RetailOrder[]).map((o) => ({
    ...o,
    total: Number(o.total),
    seller_total: Number(o.seller_total ?? o.total),
    platform_fee_percent: Number(o.platform_fee_percent ?? 0),
    platform_fee_amount: Number(o.platform_fee_amount ?? 0),
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
