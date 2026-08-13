/**
 * Admin credit purchasing.
 *
 * Credit supply is a platform-owner power: nothing in this module can create
 * credits. A shop admin submits a purchase order with a GCash reference; the
 * platform owner approves it, and only that approval writes the single credit
 * ledger entry. Rejection releases nothing, and an approved order can later be
 * frozen (the credits are pulled back) when a payment is disputed.
 *
 * There is no automatic GCash confirmation here — verification is manual by
 * design. The order status field is the abstraction an official payment API
 * would later drive, without touching the credit ledger logic.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CreditPackage = Database["public"]["Tables"]["credit_packages"]["Row"];
export type CreditPurchaseOrder =
  Database["public"]["Tables"]["credit_purchase_orders"]["Row"];
export type OrderStatus = "pending" | "approved" | "rejected" | "frozen";

export interface CreditPurchaseSettings {
  admin_credit_discount_percent: number;
  /** Discount an admin gets when buying vouchers from their own uploaded inventory. */
  admin_voucher_discount_percent: number;
  credit_gcash_number: string;
  credit_gcash_account_name: string;
  credit_payment_instructions: string;
  credit_release_mode: string;
  default_admin_sale_commission_percent: number;
  currency: string;
  /**
   * Read-only contact channel published by the platform owner. Only the name,
   * URL and message are exposed here — never any other platform setting.
   */
  support_page_name?: string | null;
  support_page_url?: string | null;
  support_message?: string | null;
  /**
   * Platform-wide GCash collection account configured by the platform owner.
   * Read-only here: admins can see where to pay but never edit these.
   */
  gcash_number?: string | null;
  gcash_account_name?: string | null;
  payment_instructions?: string | null;
}

/**
 * The GCash account an admin should pay for a credit allocation.
 *
 * There is exactly one platform source of truth: the platform owner's
 * settings. A credit-specific account is used when the owner published one,
 * otherwise the platform collection account applies, so changing the account
 * in Platform settings updates this screen immediately.
 */
export function creditGcashAccount(
  settings: CreditPurchaseSettings | null | undefined,
): { number: string; accountName: string; instructions: string } | null {
  const number =
    (settings?.credit_gcash_number ?? "").trim() || (settings?.gcash_number ?? "").trim();
  if (!number) return null;
  const accountName =
    ((settings?.credit_gcash_number ?? "").trim()
      ? (settings?.credit_gcash_account_name ?? "").trim()
      : (settings?.gcash_account_name ?? "").trim()) || "Platform GCash";
  const instructions =
    (settings?.credit_payment_instructions ?? "").trim() ||
    (settings?.payment_instructions ?? "").trim();
  return { number, accountName, instructions };
}

/** Contact card details for the credit purchase flow, or null when unpublished. */
export function supportContact(
  settings: Pick<CreditPurchaseSettings, "support_page_name" | "support_page_url" | "support_message"> | null | undefined,
): { href: string; label: string; message: string } | null {
  const raw = (settings?.support_page_url ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return {
    href: url.toString(),
    label: (settings?.support_page_name ?? "").trim() || url.hostname.replace(/^www\./, ""),
    message: (settings?.support_message ?? "").trim(),
  };
}

export const RELEASE_WARNING =
  "Credits may reflect immediately as pending/held, but Superadmins have the right to freeze or withhold released credits if the GCash transaction cannot be verified or is disputed.";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending verification",
  approved: "Approved — credits released",
  rejected: "Rejected",
  frozen: "Frozen — credits pulled back",
};

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Payable amount after the configured admin discount. */
export function amountDue(listPhp: number, discountPercent: number): number {
  const pct = Math.max(0, Math.min(100, discountPercent));
  return Math.round(listPhp * (100 - pct)) / 100;
}

export function formatPhp(amount: number, currency = "PHP"): string {
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ------------------------------------------------------------------ packages */

export async function fetchCreditPackages(activeOnly = false): Promise<CreditPackage[]> {
  let q = supabase.from("credit_packages").select("*").order("sort_order").order("credits");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditPackage[];
}

export async function saveCreditPackage(input: {
  id?: string | null;
  name: string;
  credits: number;
  pricePhp: number;
  active: boolean;
  sortOrder?: number;
}): Promise<CreditPackage> {
  return unwrap(
    await supabase.rpc("save_credit_package", {
      // The database treats a null id as "create a new package".
      _id: (input.id ?? null) as unknown as string,
      _name: input.name,
      _credits: input.credits,
      _price_php: input.pricePhp,
      _active: input.active,
      _sort_order: input.sortOrder ?? 0,
    }),
  ) as unknown as CreditPackage;
}

export async function deleteCreditPackage(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_credit_package", { _id: id });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ settings */

export async function fetchCreditPurchaseSettings(): Promise<CreditPurchaseSettings | null> {
  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "admin_credit_discount_percent, admin_voucher_discount_percent, credit_gcash_number, credit_gcash_account_name, credit_payment_instructions, credit_release_mode, default_admin_sale_commission_percent, currency, support_page_name, support_page_url, support_message, gcash_number, gcash_account_name, payment_instructions",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CreditPurchaseSettings | null) ?? null;
}

export async function updateCreditPurchaseSettings(
  input: CreditPurchaseSettings,
): Promise<void> {
  const { error } = await supabase.rpc("update_credit_purchase_settings", {
    _admin_credit_discount_percent: input.admin_credit_discount_percent,
    _credit_gcash_number: input.credit_gcash_number,
    _credit_gcash_account_name: input.credit_gcash_account_name,
    _credit_payment_instructions: input.credit_payment_instructions,
    _credit_release_mode: input.credit_release_mode,
    _default_admin_sale_commission_percent: input.default_admin_sale_commission_percent,
    _admin_voucher_discount_percent: input.admin_voucher_discount_percent,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------- orders */

export async function createCreditPurchaseOrder(input: {
  packageId: string;
  quantity: number;
  paymentReference: string;
  note?: string;
}): Promise<CreditPurchaseOrder> {
  return unwrap(
    await supabase.rpc("create_credit_purchase_order", {
      _package_id: input.packageId,
      _quantity: input.quantity,
      _payment_reference: input.paymentReference,
      ...(input.note ? { _note: input.note } : {}),
    }),
  ) as unknown as CreditPurchaseOrder;
}

export async function reviewCreditPurchaseOrder(
  orderId: string,
  approve: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc("review_credit_purchase_order", {
    _order_id: orderId,
    _approve: approve,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function freezeCreditPurchaseOrder(
  orderId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("freeze_credit_purchase_order", {
    _order_id: orderId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

/** RLS decides what comes back: own orders, own shop's orders, or every order. */
export async function fetchCreditPurchaseOrders(input?: {
  ecosystemId?: string | null;
  status?: OrderStatus | null;
  limit?: number;
}): Promise<CreditPurchaseOrder[]> {
  let q = supabase
    .from("credit_purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(input?.limit ?? 100);
  if (input?.ecosystemId) q = q.eq("ecosystem_id", input.ecosystemId);
  if (input?.status) q = q.eq("status", input.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditPurchaseOrder[];
}
