/**
 * Pure seller-side product form rules.
 *
 * The database stays authoritative (price >= 0, stock >= 0, shop-admin RLS,
 * `retail_platform_fee_percent`); these checks only stop obviously broken
 * drafts before a round trip and describe the fix in plain language.
 */
import { customerToSeller, sellerToCustomer, type RetailCashbackMode } from "@/lib/retail";

export interface ProductDraft {
  id?: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  variant: string;
  size_label: string;
  unit: string;
  sku: string;
  barcode: string;
  /** Seller's Cut per unit (what the shop keeps, fee excluded). */
  price: string;
  wholesale_price: string;
  wholesale_min_qty: string;
  cashback_mode: RetailCashbackMode;
  cashback_value: string;
  stock: string;
  image_path: string | null;
  public_visible: boolean;
  active: boolean;
  published: boolean;
}

export const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  name: "",
  description: "",
  category: "",
  brand: "",
  variant: "",
  size_label: "",
  unit: "piece",
  sku: "",
  barcode: "",
  price: "",
  wholesale_price: "",
  wholesale_min_qty: "",
  cashback_mode: "disabled",
  cashback_value: "0",
  stock: "0",
  image_path: null,
  public_visible: true,
  active: true,
  published: false,
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Seller's Cut typed as text → customer Retail Price (fee embedded once). */
export const retailPriceOf = (sellerCut: string, feePercent: number): number => {
  const n = num(sellerCut);
  return n > 0 ? sellerToCustomer(n, feePercent) : 0;
};

/** Customer Retail Price typed as text → Seller's Cut text. */
export const sellerCutOf = (retailPrice: string, feePercent: number): string => {
  const n = num(retailPrice);
  return n > 0 ? String(customerToSeller(n, feePercent)) : "";
};

/** Stock is whole units and never negative; blanks read as 0. */
export const normalizeStock = (v: string): number => Math.max(0, Math.round(num(v)));

export interface DraftProblem {
  field: keyof ProductDraft;
  message: string;
}

/** All problems for a draft, in the order the form shows its sections. */
export function validateProductDraft(d: ProductDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  const price = num(d.price);
  const stock = num(d.stock);
  const wholesale = num(d.wholesale_price);
  const minQty = num(d.wholesale_min_qty);
  const cashback = num(d.cashback_value);

  if (!d.name.trim()) out.push({ field: "name", message: "Give the product a name." });
  if (price < 0) out.push({ field: "price", message: "Price cannot be negative." });
  if (stock < 0 || !Number.isInteger(stock))
    out.push({ field: "stock", message: "Stock must be a whole number, zero or more." });

  const hasWholesale = wholesale > 0 || minQty > 0;
  if (hasWholesale) {
    if (wholesale <= 0)
      out.push({ field: "wholesale_price", message: "Set the bulk price per unit." });
    if (minQty < 2 || !Number.isInteger(minQty))
      out.push({
        field: "wholesale_min_qty",
        message: "Bulk pricing needs a minimum quantity of at least 2.",
      });
    if (price > 0 && wholesale >= price)
      out.push({
        field: "wholesale_price",
        message: "The bulk price must be lower than the regular price.",
      });
  }

  if (d.cashback_mode === "percent" && (cashback < 0 || cashback > 100))
    out.push({ field: "cashback_value", message: "Cashback percent must be between 0 and 100." });
  if (d.cashback_mode === "fixed" && cashback < 0)
    out.push({ field: "cashback_value", message: "Cashback per unit cannot be negative." });
  if (d.cashback_mode === "fixed" && price > 0 && cashback > price)
    out.push({
      field: "cashback_value",
      message: "Cashback per unit cannot exceed your Seller's Cut.",
    });

  if (d.published) {
    if (price <= 0) out.push({ field: "price", message: "Set a price before going live." });
    if (stock <= 0) out.push({ field: "stock", message: "Add stock before going live." });
  }
  return out;
}

/** A copy of a product as a fresh, unpublished draft. */
export function duplicateDraft(d: ProductDraft): ProductDraft {
  const { id: _id, ...rest } = d;
  void _id;
  return { ...rest, name: `${d.name} (copy)`, sku: "", barcode: "", published: false };
}
