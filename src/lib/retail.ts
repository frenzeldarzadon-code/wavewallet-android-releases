/**
 * Retail store — physical goods sold by one shop.
 *
 * Everything here is scoped to a single ecosystem: products, stock, orders,
 * ratings and payment options belong to that shop only, and the database
 * re-checks membership and admin rights on every call. Credits are held when
 * an order is placed and returned in full when it is rejected or cancelled,
 * so an unconfirmed order never permanently consumes a wallet.
 */
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
}

export interface OrderItem {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
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
  total: number;
  decision_note: string | null;
  created_at: string;
  items: OrderItem[];
}

/* ------------------------------------------------------------------ */
/* Cart maths — pure so checkout rules can be asserted in tests         */
/* ------------------------------------------------------------------ */

export type Cart = Record<string, number>;

export interface CartLine {
  product: RetailProduct;
  quantity: number;
  lineTotal: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function cartLines(cart: Cart, products: RetailProduct[]): CartLine[] {
  return products
    .filter((p) => (cart[p.id] ?? 0) > 0)
    .map((product) => {
      const quantity = cart[product.id] ?? 0;
      return { product, quantity, lineTotal: round2(product.price * quantity) };
    });
}

export const cartCount = (cart: Cart) =>
  Object.values(cart).reduce((sum, q) => sum + (q > 0 ? q : 0), 0);

export const cartTotal = (cart: Cart, products: RetailProduct[]) =>
  round2(cartLines(cart, products).reduce((sum, l) => sum + l.lineTotal, 0));

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
    if (!settings.creditEnabled) return "This shop does not accept credit payment";
    if (total > creditBalance) return "Not enough credits in this shop's wallet";
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

export async function saveStoreSettings(
  ecosystemId: string,
  s: Omit<StoreSettings, "contactEmail">,
): Promise<void> {
  const { error } = await supabase
    .from("ecosystems")
    .update({
      store_voucher_enabled: s.voucherEnabled,
      store_retail_enabled: s.retailEnabled,
      retail_cash_enabled: s.cashEnabled,
      retail_credit_enabled: s.creditEnabled,
      retail_pickup_enabled: s.pickupEnabled,
      retail_delivery_enabled: s.deliveryEnabled,
      public_storefront_enabled: s.publicStorefront,
    })
    .eq("id", ecosystemId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export async function fetchRetailProducts(ecosystemId: string): Promise<RetailProduct[]> {
  const { data, error } = await supabase.rpc("list_retail_products", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RetailProduct[]).map((p) => ({ ...p, price: Number(p.price) }));
}

export interface RetailProductRow extends RetailProduct {
  active: boolean;
  archived: boolean;
}

/** Admin view: includes hidden and archived products. */
export async function fetchAllRetailProducts(ecosystemId: string): Promise<RetailProductRow[]> {
  const { data, error } = await supabase
    .from("retail_products")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("archived")
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RetailProductRow[]).map((p) => ({
    ...p,
    price: Number(p.price),
    rating_avg: 0,
    rating_count: 0,
  }));
}

export interface RetailProductInput {
  id?: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image_path: string | null;
  public_visible: boolean;
  active: boolean;
}

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
  };
  const { error } = input.id
    ? await supabase.from("retail_products").update(payload).eq("id", input.id)
    : await supabase.from("retail_products").insert(payload);
  if (error) throw new Error(error.message);
}

/** Archiving hides a product without deleting it or any past order. */
export async function setRetailProductArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from("retail_products")
    .update({ archived, ...(archived ? { active: false } : {}) })
    .eq("id", id);
  if (error) throw new Error(error.message);
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
): Promise<PlacedOrder> {
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
    items: (o.items ?? []).map((i) => ({
      ...i,
      unit_price: Number(i.unit_price),
      line_total: Number(i.line_total),
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
