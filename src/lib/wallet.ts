/**
 * Stage 3 — credit wallet + manual voucher inventory data layer.
 *
 * Every mutation goes through a SECURITY DEFINER RPC that authorizes the caller
 * against their ecosystem and role in the database. Nothing here is trusted:
 * balances are always read back from the ledger-maintained account rows.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/wavewallet";
import { groupSaleCodes } from "@/lib/voucher-transactions";


export interface CreditEntry {
  id: string;
  direction: "credit" | "debit";
  amount: number;
  balance_after: number;
  reason: string;
  reference: string | null;
  tx_id: string | null;
  created_at: string;
  user_id: string;
  /** Base amount before any reseller commission bonus (snapshotted at transaction time). */
  base_amount?: number | null;
  /** Commission rate used for this transaction — historical, never rewritten. */
  commission_percent?: number | null;
  /** Bonus credits granted on top of the base amount. */
  commission_amount?: number | null;
  /** 'purchase' | 'sale_commission' | 'general' — how this entry was produced. */
  entry_kind?: string | null;
  /** Voucher sale that generated this entry (credit-back / purchase debits). */
  sale_id?: string | null;
}

export const LEDGER_COLUMNS =
  "id, direction, amount, balance_after, reason, reference, tx_id, created_at, user_id, base_amount, commission_percent, commission_amount, entry_kind, sale_id";


/** Normalises the numeric columns coming back from PostgREST. */
export function normalizeEntry(e: CreditEntry): CreditEntry {
  return {
    ...e,
    amount: Number(e.amount),
    balance_after: Number(e.balance_after),
    base_amount: e.base_amount === null || e.base_amount === undefined ? null : Number(e.base_amount),
    commission_percent:
      e.commission_percent === null || e.commission_percent === undefined
        ? null
        : Number(e.commission_percent),
    commission_amount:
      e.commission_amount === null || e.commission_amount === undefined
        ? null
        : Number(e.commission_amount),
  };
}

/** True when this entry carries a reseller commission bonus. */
export function hasCommission(e: CreditEntry): boolean {
  return Number(e.commission_amount ?? 0) > 0;
}


export interface VoucherProductRow {
  id: string;
  ecosystem_id: string;
  name: string;
  description: string;
  credit_price: number;
  points_price: number | null;
  promo_price: number | null;
  promo_note: string | null;
  active: boolean;
  archived: boolean;
  created_at: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string;
  credit_price: number;
  points_price: number | null;
  promo_price: number | null;
  promo_note: string | null;
  available: number;
  rating_avg: number | null;
  rating_count: number;
  /** Completed, non-refunded voucher sales only. */
  sold_count: number;
}

export interface SaleRow {
  id: string;
  product_name: string;
  buyer_id: string;
  buyer_role: string;
  reseller_id: string | null;
  list_price: number;
  discount_percent: number;
  sale_price: number;
  payment_method: string;
  tx_id: string;
  created_at: string;
}

export const listPrice = (p: { credit_price: number; promo_price: number | null }) =>
  Number(p.promo_price ?? p.credit_price);

/**
 * Credits actually charged for a voucher after the buyer's shop discount.
 * Admins get the platform-wide admin voucher discount (default 100% off),
 * resellers/subresellers their configured discount. Mirrors purchase_voucher.
 */
export const voucherCost = (list: number, discountPercent: number) => {
  const pct = Math.max(0, Math.min(100, discountPercent));
  return Math.round(list * (100 - pct)) / 100;
};


/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface WalletView {
  accountId: string | null;
  balance: number;
  /** True when the shop is a Universe shop (or no shop): the single global wallet. */
  isGlobal: boolean;
}

/**
 * Which wallet backs (member, shop). New Generation shops keep a wallet per
 * shop; Universe shops share the member's single global wallet. The database
 * decides — the client never guesses from the shop kind.
 */
export async function fetchWalletView(
  userId: string,
  ecosystemId: string | null,
): Promise<WalletView> {
  const { data, error } = await supabase.rpc("wallet_view", {
    _user_id: userId,
    ...(ecosystemId ? { _ecosystem_id: ecosystemId } : {}),
  });
  if (error) {
    // Fall back to the direct read so a transient RPC failure never hides a balance.
    const q = supabase.from("credit_accounts").select("id, balance").eq("user_id", userId);
    const { data: row } = await (ecosystemId
      ? q.eq("ecosystem_id", ecosystemId)
      : q.is("ecosystem_id", null)
    ).maybeSingle();
    return { accountId: row?.id ?? null, balance: Number(row?.balance ?? 0), isGlobal: !ecosystemId };
  }
  const row = (data as { account_id: string; balance: number; is_global: boolean }[] | null)?.[0];
  return {
    accountId: row?.account_id ?? null,
    balance: Number(row?.balance ?? 0),
    isGlobal: row ? Boolean(row.is_global) : !ecosystemId,
  };
}

/**
 * Balance of the wallet that serves this shop. New Generation shops have their
 * own wallet per member; Universe shops (and `null`) read the global wallet.
 * Entering a shop only changes which wallet is read — it never moves credits.
 */
export async function fetchCreditBalance(
  userId: string,
  ecosystemId: string | null,
): Promise<number> {
  return (await fetchWalletView(userId, ecosystemId)).balance;
}

/**
 * Credit movements of the wallet serving this shop. Shop wallets are filtered by
 * shop; the global Universe wallet shows every movement on that wallet (sales
 * of any Universe shop are still tagged with the selling shop).
 */
export async function fetchCreditLedger(
  userId: string,
  ecosystemId: string | null,
  limit = 100,
): Promise<CreditEntry[]> {
  const view = await fetchWalletView(userId, ecosystemId);
  const q = supabase.from("credit_ledger").select(LEDGER_COLUMNS).eq("user_id", userId);
  const scoped = view.isGlobal && view.accountId
    ? q.eq("account_id", view.accountId)
    : ecosystemId
      ? q.eq("ecosystem_id", ecosystemId)
      : q.is("ecosystem_id", null);
  const { data } = await scoped.order("created_at", { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as CreditEntry[]).map(normalizeEntry);
}

/** Ecosystem-wide credit movements (admin/super-admin views; RLS still applies). */
export async function fetchEcosystemLedger(
  ecosystemId: string,
  limit = 200,
): Promise<CreditEntry[]> {
  const { data } = await supabase
    .from("credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as CreditEntry[]).map(normalizeEntry);
}

/**
 * Resolves the commission rate the database would apply if the signed-in
 * admin released credits to this member. The client can only read it —
 * the rate used on a transfer is always recomputed server-side.
 */
export async function fetchCommissionRate(recipientId: string): Promise<number> {
  const { data, error } = await supabase.rpc("commission_rate_for", {
    _sender: (await supabase.auth.getUser()).data.user?.id ?? recipientId,
    _recipient: recipientId,
  });
  if (error) return 0;
  return Number(data ?? 0);
}

/**
 * Admin/super-admin sets a reseller's personal commission — future transfers only.
 * Pass `null` to clear the override so the reseller follows the shop default.
 */
export async function setResellerCommission(
  userId: string,
  percent: number | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_reseller_commission", {
    _user_id: userId,
    // `null` clears the override; the RPC accepts it even though the generated
    // type narrows the argument to a number.
    _percent: (percent === null ? null : Math.trunc(percent)) as unknown as number,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}

/** Shop-wide default commission applied to resellers without a personal override. */
export async function fetchEcosystemCommission(ecosystemId: string): Promise<number> {
  const { data, error } = await supabase
    .from("ecosystems")
    .select("default_commission_percent")
    .eq("id", ecosystemId)
    .maybeSingle();
  if (error || !data) return 0;
  return Number(data.default_commission_percent ?? 0);
}

/**
 * Admin (own shop) or super admin (any shop) sets the default commission.
 * Validation and authorization are enforced in the database; the change is
 * audit-logged and only affects future credit releases.
 */
export async function setEcosystemCommission(
  ecosystemId: string,
  percent: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("set_ecosystem_commission", {
    _ecosystem_id: ecosystemId,
    _percent: Math.trunc(percent),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return Number(data ?? percent);
}

/* ------------------------------------------------------------------ */
/* Sales credit-back — a SEPARATE commission from credit loading       */
/* ------------------------------------------------------------------ */

export interface SaleCommissionDefaults {
  reseller: number;
  subreseller: number;
}

/** Shop-wide credit-back defaults paid when a customer spends funded credits. */
export async function fetchEcosystemSaleCommission(
  ecosystemId: string,
): Promise<SaleCommissionDefaults> {
  const { data, error } = await supabase
    .from("ecosystems")
    .select("default_sale_commission_percent, default_subreseller_sale_commission_percent")
    .eq("id", ecosystemId)
    .maybeSingle();
  if (error || !data) return { reseller: 0, subreseller: 0 };
  return {
    reseller: Number(data.default_sale_commission_percent ?? 0),
    subreseller: Number(data.default_subreseller_sale_commission_percent ?? 0),
  };
}

/** Admin (own shop) or super admin sets both shop-wide credit-back defaults. */
export async function setEcosystemSaleCommission(
  ecosystemId: string,
  percents: SaleCommissionDefaults,
): Promise<void> {
  const { error } = await supabase.rpc("set_ecosystem_sale_commission", {
    _ecosystem_id: ecosystemId,
    _reseller_percent: Math.trunc(percents.reseller),
    _subreseller_percent: Math.trunc(percents.subreseller),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}

/* ------------------------------------------------------------------ */
/* Final rate model: sale cashback, upline commission, wholesale       */
/* discounts. Credit transfers themselves carry no commission.         */
/* ------------------------------------------------------------------ */

export interface EcosystemRates {
  /** Cashback for a reseller whose credits funded a customer purchase. */
  resellerSale: number;
  /** Cashback for a subreseller whose credits funded a customer purchase. */
  subresellerSale: number;
  /** Commission for the parent reseller of a selling/buying subreseller. */
  upline: number;
  /** Wholesale voucher discount for resellers. */
  resellerDiscount: number;
  /** Wholesale voucher discount for subresellers. */
  subresellerDiscount: number;
}

const RATE_COLUMNS =
  "default_sale_commission_percent, default_subreseller_sale_commission_percent, default_upline_commission_percent, default_reseller_discount_percent, default_subreseller_discount_percent";

export async function fetchEcosystemRates(ecosystemId: string): Promise<EcosystemRates> {
  const { data, error } = await supabase
    .from("ecosystems")
    .select(RATE_COLUMNS)
    .eq("id", ecosystemId)
    .maybeSingle();
  if (error || !data) {
    return {
      resellerSale: 0,
      subresellerSale: 0,
      upline: 0,
      resellerDiscount: 0,
      subresellerDiscount: 0,
    };
  }
  return {
    resellerSale: Number(data.default_sale_commission_percent ?? 0),
    subresellerSale: Number(data.default_subreseller_sale_commission_percent ?? 0),
    upline: Number(data.default_upline_commission_percent ?? 0),
    resellerDiscount: Number(data.default_reseller_discount_percent ?? 0),
    subresellerDiscount: Number(data.default_subreseller_discount_percent ?? 0),
  };
}

/**
 * Saves every rate in one audited call. Validation and authorization live in
 * the database; changes apply to future transactions only.
 */
export async function setEcosystemRates(
  ecosystemId: string,
  rates: EcosystemRates,
): Promise<void> {
  const { error } = await supabase.rpc("set_ecosystem_rates", {
    _ecosystem_id: ecosystemId,
    _reseller_sale_percent: Math.trunc(rates.resellerSale),
    _subreseller_sale_percent: Math.trunc(rates.subresellerSale),
    _upline_percent: Math.trunc(rates.upline),
    _reseller_discount_percent: Math.trunc(rates.resellerDiscount),
    _subreseller_discount_percent: Math.trunc(rates.subresellerDiscount),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}

/**
 * Effective voucher shop discount for a member in one shop. It is exactly that
 * member's configured Discount — there is no second, editable percentage.
 * Resolved server-side so the price shown before checkout matches the charge.
 */
export async function fetchMyVoucherDiscount(
  userId: string,
  ecosystemId?: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc("voucher_discount_percent_for", {
    _user_id: userId,
    _ecosystem_id: (ecosystemId ?? null) as unknown as string,
  });
  if (error) return 0;
  return Number(data ?? 0);
}


/** Per-member credit-back override. `null` follows the shop default. */
export async function setSaleCommission(userId: string, percent: number | null): Promise<void> {
  const { error } = await supabase.rpc("set_sale_commission", {
    _user_id: userId,
    _percent: (percent === null ? null : Math.trunc(percent)) as unknown as number,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}

/**
 * Moves a subreseller under a different parent reseller in the same shop.
 *
 * The shop is passed explicitly so the change applies to that membership only —
 * the member's role or parent in any other shop is never consulted or touched.
 */
export async function setSubresellerParent(
  userId: string,
  resellerId: string,
  ecosystemId?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_subreseller_parent", {
    _user_id: userId,
    _reseller_id: resellerId,
    ...(ecosystemId ? { _ecosystem_id: ecosystemId } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}




export async function fetchShopProducts(): Promise<ShopProduct[]> {
  const { data, error } = await supabase.rpc("list_shop_products");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ShopProduct[]).map((p) => ({
    ...p,
    credit_price: Number(p.credit_price),
    promo_price: p.promo_price === null ? null : Number(p.promo_price),
    rating_avg: p.rating_avg === null ? null : Number(p.rating_avg),
    rating_count: Number(p.rating_count ?? 0),
    sold_count: Number(p.sold_count ?? 0),
  }));
}

export async function fetchProducts(ecosystemId: string): Promise<VoucherProductRow[]> {
  const { data, error } = await supabase
    .from("voucher_products")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as VoucherProductRow[]).map((p) => ({
    ...p,
    credit_price: Number(p.credit_price),
    promo_price: p.promo_price === null ? null : Number(p.promo_price),
  }));
}

export interface InventoryCount {
  product_id: string;
  total: number;
  unused: number;
  sold: number;
}

export async function fetchInventoryCounts(ecosystemId: string): Promise<Record<string, InventoryCount>> {
  const { data, error } = await supabase.rpc("admin_product_inventory", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  const map: Record<string, InventoryCount> = {};
  for (const row of (data ?? []) as unknown as InventoryCount[]) map[row.product_id] = row;
  return map;
}

export async function fetchImports(ecosystemId: string) {
  const { data } = await supabase
    .from("voucher_imports")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
    .limit(25);
  return data ?? [];
}

export async function fetchSales(ecosystemId: string, limit = 50): Promise<SaleRow[]> {
  const { data } = await supabase
    .from("voucher_sales")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as SaleRow[]).map((s) => ({
    ...s,
    list_price: Number(s.list_price),
    sale_price: Number(s.sale_price),
  }));
}

/**
 * Buyer-visible purchases (RLS returns only the caller's own rows).
 *
 * One sale is one transaction: every code that sale issued is attached to it
 * through `voucher_codes.sale_id`, so a quantity-5 purchase keeps its five
 * codes together and can never pick up a code from another transaction.
 */
export async function fetchMyPurchases(userId: string, ecosystemId: string | null) {
  const sold = supabase
    .from("voucher_sales")
    .select("*")
    .eq("buyer_id", userId);
  const owned = supabase.from("voucher_codes").select("code, sale_id").eq("sold_to", userId);
  const [{ data: sales }, { data: codes }] = await Promise.all([
    (ecosystemId ? sold.eq("ecosystem_id", ecosystemId) : sold)
      .order("created_at", { ascending: false })
      .limit(100),
    ecosystemId ? owned.eq("ecosystem_id", ecosystemId) : owned,
  ]);
  const codesBySale = groupSaleCodes((codes ?? []) as { code: string; sale_id: string | null }[]);
  return ((sales ?? []) as unknown as SaleRow[]).map((s) => {
    const list = codesBySale.get(s.id) ?? [];
    return {
      ...s,
      sale_price: Number(s.sale_price),
      list_price: Number(s.list_price),
      /** All codes of this exact transaction. */
      codes: list,
      /** First code, kept for callers that show a single voucher. */
      code: list[0] ?? null,
    };
  });
}


/* ------------------------------------------------------------------ */
/* Mutations (all authorized inside the database)                      */
/* ------------------------------------------------------------------ */

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendlyWalletError(res.error.message));
  return res.data;
}

export async function adminAdjustCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  reference?: string;
  /** Shop whose wallet is affected — never guessed from the member's last shop. */
  ecosystemId?: string | null;
}): Promise<string> {
  requireOnline();
  return unwrap(
    await supabase.rpc("admin_adjust_credits", {
      _user_id: input.userId,
      _amount: input.amount,
      _reason: input.reason,
      ...(input.reference ? { _reference: input.reference } : {}),
      ...(input.ecosystemId ? { _ecosystem_id: input.ecosystemId } : {}),
    }),
  ) as unknown as string;
}

/**
 * Hands credits to a member of the selected shop.
 *
 * A shop admin spends their OWN shop balance. The platform owner is the one
 * global exception: the database mints the credits straight into the member's
 * wallet in that shop, with no source balance and no fee.
 */
export async function adminLoadCredits(input: {
  userId: string;
  amount: number;
  reason?: string;
  reference?: string;
  ecosystemId?: string | null;
}): Promise<string> {
  requireOnline();
  return unwrap(
    await supabase.rpc("admin_load_credits", {
      _user_id: input.userId,
      _amount: input.amount,
      ...(input.reason ? { _reason: input.reason } : {}),
      ...(input.reference ? { _reference: input.reference } : {}),
      ...(input.ecosystemId ? { _ecosystem_id: input.ecosystemId } : {}),
    }),
  ) as unknown as string;
}

export async function resellerLoadCredits(input: {
  customerId: string;
  amount: number;
  reference?: string;
}): Promise<string> {
  requireOnline();
  return unwrap(
    await supabase.rpc("reseller_load_credits", {
      _customer_id: input.customerId,
      _amount: input.amount,
      ...(input.reference ? { _reference: input.reference } : {}),
    }),
  ) as unknown as string;
}

export async function transferCredits(input: {
  recipientId: string;
  amount: number;
  note?: string;
}): Promise<string> {
  requireOnline();
  return unwrap(
    await supabase.rpc("transfer_credits", {
      _recipient_id: input.recipientId,
      _amount: input.amount,
      ...(input.note ? { _note: input.note } : {}),
    }),
  ) as unknown as string;
}

export interface RecipientMatch {
  id: string;
  full_name: string;
  /** Social handle, when the member has claimed one. */
  handle?: string | null;
  avatar_path?: string | null;
  /** Masked for members, full for shop staff. */
  phone: string;
  masked_email: string;
}


export async function lookupRecipient(query: string): Promise<RecipientMatch[]> {
  const { data, error } = await supabase.rpc("lookup_transfer_recipient", { _query: query });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data ?? []) as unknown as RecipientMatch[];
}

export interface ImportResult {
  batch_id: string;
  imported_count: number;
  duplicate_count: number;
  invalid_count: number;
}

export async function importVoucherCodes(
  productId: string,
  codes: string[],
  source: "paste" | "file",
): Promise<ImportResult> {
  const { data, error } = await supabase.rpc("import_voucher_codes", {
    _product_id: productId,
    _codes: codes,
    _source: source,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data as unknown as ImportResult[])[0]!;
}

export type { VoucherBatch } from "@/lib/voucher-inventory";

/** Upload batches with per-batch eligibility for deletion. */
export async function fetchVoucherBatches(ecosystemId: string) {
  const { data, error } = await supabase.rpc("list_voucher_batches", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as import("@/lib/voucher-inventory").VoucherBatch[];
}

/** Deletes one unused voucher code. Sold/assigned codes are rejected server-side. */
export async function deleteVoucherCode(codeId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_voucher_code", { _code_id: codeId });
  if (error) throw new Error(friendlyWalletError(error.message));
}

/** Atomically deletes an entire fully-unused upload batch. Returns codes removed. */
export async function deleteVoucherBatch(batchId: string): Promise<number> {
  const { data, error } = await supabase.rpc("delete_voucher_batch", { _import_id: batchId });
  if (error) throw new Error(friendlyWalletError(error.message));
  return Number(data ?? 0);
}

/**
 * Deletes ONLY the unused codes of a partially-sold batch. Sold/used codes and
 * their history stay untouched. WaveWallet-only: nothing on Omada is affected.
 */
export async function deleteUnusedVoucherBatch(batchId: string): Promise<number> {
  const { data, error } = await supabase.rpc("delete_voucher_batch_unused", { _import_id: batchId });
  if (error) throw new Error(friendlyWalletError(error.message));
  return Number(data ?? 0);
}

export interface PurchaseResult {
  tx_id: string;
  /** One code per purchased voucher. */
  codes: string[];
  /** Total charged for the whole purchase. */
  sale_price: number;
  unit_price: number;
  quantity: number;
  product_name: string;
  sale_id: string;
  points_earned: number;
  /** Credit-back granted to the buyer's upline reseller/subreseller. */
  commission_amount: number;
  commission_percent: number;
}

export async function purchaseVoucher(productId: string, quantity = 1): Promise<PurchaseResult> {
  requireOnline();
  const { data, error } = await supabase.rpc("purchase_voucher", {
    _product_id: productId,
    _quantity: quantity,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  const row = (data as unknown as PurchaseResult[])[0];
  if (!row) throw new Error("Purchase could not be completed.");
  return {
    ...row,
    codes: row.codes ?? [],
    sale_price: Number(row.sale_price),
    unit_price: Number(row.unit_price),
    quantity: Number(row.quantity),
    commission_amount: Number(row.commission_amount ?? 0),
    commission_percent: Number(row.commission_percent ?? 0),
  };
}


export function friendlyWalletError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("insufficient credits")) return "Not enough coins for this transaction.";
  if (m.includes("no voucher codes are available"))
    return "This voucher is out of stock. Nothing was charged.";
  if (m.includes("row-level security") || m.includes("permission denied"))
    return "You are not allowed to do that.";
  return message.replace(/^.*?:\s/, "");
}

/* ------------------------------------------------------------------ */
/* Manual code parsing (paste + file upload)                           */
/* ------------------------------------------------------------------ */

/** Splits pasted text into one code per row. Blank rows are ignored, whitespace trimmed. */
export function parsePastedCodes(raw: string): string[] {
  return raw
    .split(/[\r\n,;\t]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Reads a txt/csv/xlsx file with one voucher code per row. No fixed column
 * layout is required — the first non-empty cell of each row is used.
 */
export async function parseCodeFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const codes: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
        header: 1,
        blankrows: false,
      });
      for (const row of rows) {
        const cell = (row ?? []).map((c) => String(c ?? "").trim()).find(Boolean);
        if (cell) codes.push(cell);
      }
    }
    return codes;
  }
  const text = await file.text();
  return parsePastedCodes(text);
}

/* ------------------------------------------------------------------ */
/* Commission display helpers                                          */
/* ------------------------------------------------------------------ */

/**
 * Human-readable breakdown of a commission-bearing credit entry, e.g.
 * "Coin received: 1,000 + 200 commission = 1,200".
 * Values come from the snapshot stored on the ledger row, so historical
 * entries keep the rate that was in force when they were created.
 */
export function commissionBreakdown(e: CreditEntry): string | null {
  const bonus = Number(e.commission_amount ?? 0);
  if (bonus <= 0) return null;
  const base = Number(e.base_amount ?? e.amount);
  const pct = Number(e.commission_percent ?? 0);
  if (e.entry_kind === "sale_commission") {
    return `Sales cashback on ${peso(base)} of coins you supplied, spent at ${pct}% = ${peso(bonus)}`;
  }
  if (e.entry_kind === "upline_commission") {
    return `Upline commission — ${pct}% of ${peso(base)} from your downline's sale = ${peso(bonus)}`;
  }
  // Anything left is a pre-migration credit-loading commission. Transfers no
  // longer create these; the snapshot is kept exactly as it was recorded.
  if (e.direction === "debit") {
    return `Historical loading commission — released ${peso(base)} at ${pct}% (${peso(bonus)}); you were debited ${peso(base)} only`;
  }
  return `Historical loading commission — ${peso(base)} + ${peso(bonus)} (${pct}%) = ${peso(base + bonus)}`;
}


/* ------------------------------------------------------------------ */
/* Credit provenance (FIFO lots)                                       */
/* ------------------------------------------------------------------ */

/**
 * A credit lot records where a batch of credits came from. Spending consumes
 * lots oldest-first, and credit-back on a voucher purchase is paid to the
 * reseller/subreseller who funded the exact credits being spent.
 */
export interface CreditLot {
  id: string;
  amount: number;
  remaining: number;
  created_at: string;
  source_kind: string;
  source_user_id: string | null;
  source_name: string | null;
}

export async function fetchCreditLots(
  userId: string,
  ecosystemId: string | null,
  limit = 50,
): Promise<CreditLot[]> {
  const q = supabase
    .from("credit_lots")
    .select("id, amount, remaining, created_at, source_kind, source_user_id")
    .eq("user_id", userId);
  const { data, error } = await (ecosystemId ? q.eq("ecosystem_id", ecosystemId) : q)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.source_user_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profs ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    remaining: Number(r.remaining),
    created_at: r.created_at,
    source_kind: r.source_kind,
    source_user_id: r.source_user_id,
    source_name: r.source_user_id ? (names.get(r.source_user_id) ?? null) : null,
  }));
}

/** Plain-language label for where a lot of credits came from. */
export function creditSourceLabel(lot: Pick<CreditLot, "source_kind" | "source_name">): string {
  switch (lot.source_kind) {
    case "reseller":
      return lot.source_name ? `Reseller — ${lot.source_name}` : "Reseller";
    case "subreseller":
      return lot.source_name ? `Subreseller — ${lot.source_name}` : "Subreseller";
    case "admin":
      return "Shop admin (no credit-back)";
    case "self":
      return "Your own top-up";
    case "legacy":
      return "Earlier balance (source unknown)";
    default:
      return "System";
  }
}

/** One earning component of a voucher sale: seller cashback or upline commission. */
export interface SaleCommissionRow {
  id: string;
  sale_id: string;
  recipient_id: string;
  /** 'sale_cashback' (you supplied the credits) or 'upline' (your downline sold). */
  kind: string;
  credits_consumed: number;
  commission_percent: number;
  commission_amount: number;
  reversed_at: string | null;
  created_at: string;
  buyer_name: string | null;
  product_name: string | null;
  quantity: number | null;
  tx_id: string | null;
}

/** Sale earnings for a reseller/subreseller, newest first. */
export async function fetchMyCreditBack(recipientId: string, limit = 50): Promise<SaleCommissionRow[]> {
  const { data, error } = await supabase
    .from("sale_commissions")
    .select(
      "id, sale_id, recipient_id, kind, credits_consumed, commission_percent, commission_amount, reversed_at, created_at, voucher_sales(product_name, quantity, tx_id, buyer_id)",
    )
    .eq("recipient_id", recipientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<
    Record<string, unknown> & {
      voucher_sales: { product_name: string; quantity: number | null; tx_id: string; buyer_id: string } | null;
    }
  >;
  const buyerIds = [...new Set(rows.map((r) => r.voucher_sales?.buyer_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (buyerIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", buyerIds);
    for (const p of profs ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: String(r["id"]),
    sale_id: String(r["sale_id"]),
    recipient_id: String(r["recipient_id"]),
    kind: String(r["kind"] ?? "sale_cashback"),

    credits_consumed: Number(r["credits_consumed"]),
    commission_percent: Number(r["commission_percent"]),
    commission_amount: Number(r["commission_amount"]),
    reversed_at: (r["reversed_at"] as string | null) ?? null,
    created_at: String(r["created_at"]),
    buyer_name: r.voucher_sales?.buyer_id ? (names.get(r.voucher_sales.buyer_id) ?? null) : null,
    product_name: r.voucher_sales?.product_name ?? null,
    quantity: r.voucher_sales?.quantity ?? null,
    tx_id: r.voucher_sales?.tx_id ?? null,
  }));
}

