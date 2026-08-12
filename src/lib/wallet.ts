/**
 * Stage 3 — credit wallet + manual voucher inventory data layer.
 *
 * Every mutation goes through a SECURITY DEFINER RPC that authorizes the caller
 * against their ecosystem and role in the database. Nothing here is trusted:
 * balances are always read back from the ledger-maintained account rows.
 */
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/wavewallet";

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

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function fetchCreditBalance(userId: string): Promise<number> {
  const { data } = await supabase
    .from("credit_accounts")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

export async function fetchCreditLedger(userId: string, limit = 100): Promise<CreditEntry[]> {
  const { data } = await supabase
    .from("credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
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


export async function fetchShopProducts(): Promise<ShopProduct[]> {
  const { data, error } = await supabase.rpc("list_shop_products");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ShopProduct[]).map((p) => ({
    ...p,
    credit_price: Number(p.credit_price),
    promo_price: p.promo_price === null ? null : Number(p.promo_price),
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

/** Buyer-visible purchases (RLS returns only the caller's own rows). */
export async function fetchMyPurchases(userId: string) {
  const [{ data: sales }, { data: codes }] = await Promise.all([
    supabase
      .from("voucher_sales")
      .select("*")
      .eq("buyer_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("voucher_codes").select("code, sale_id").eq("sold_to", userId),
  ]);
  const codeBySale = new Map((codes ?? []).map((c) => [c.sale_id, c.code]));
  return ((sales ?? []) as unknown as SaleRow[]).map((s) => ({
    ...s,
    sale_price: Number(s.sale_price),
    list_price: Number(s.list_price),
    code: codeBySale.get(s.id) ?? null,
  }));
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
}): Promise<string> {
  return unwrap(
    await supabase.rpc("admin_adjust_credits", {
      _user_id: input.userId,
      _amount: input.amount,
      _reason: input.reason,
      ...(input.reference ? { _reference: input.reference } : {}),
    }),
  ) as unknown as string;
}

export async function resellerLoadCredits(input: {
  customerId: string;
  amount: number;
  reference?: string;
}): Promise<string> {
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
  if (m.includes("insufficient credits")) return "Not enough credits for this transaction.";
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
 * "Credit received: 1,000 + 200 commission = 1,200".
 * Values come from the snapshot stored on the ledger row, so historical
 * entries keep the rate that was in force when they were created.
 */
export function commissionBreakdown(e: CreditEntry): string | null {
  const bonus = Number(e.commission_amount ?? 0);
  if (bonus <= 0) return null;
  const base = Number(e.base_amount ?? e.amount);
  const pct = Number(e.commission_percent ?? 0);
  if (e.entry_kind === "sale_commission") {
    return `Credit-back on ${peso(base)} of credits you funded, spent at ${pct}% = ${peso(bonus)}`;
  }
  if (e.direction === "debit") {
    return `Released ${peso(base)} · ${pct}% commission granted (${peso(bonus)}) — you were debited ${peso(base)} only`;
  }
  return `${peso(base)} + ${peso(bonus)} commission (${pct}%) = ${peso(base + bonus)}`;
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

export async function fetchCreditLots(userId: string, limit = 50): Promise<CreditLot[]> {
  const { data, error } = await supabase
    .from("credit_lots")
    .select("id, amount, remaining, created_at, source_kind, source_user_id")
    .eq("user_id", userId)
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

/** One credit-back component of a voucher sale, tied to the funding lot. */
export interface SaleCommissionRow {
  id: string;
  sale_id: string;
  recipient_id: string;
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

/** Credit-back rows earned by a reseller/subreseller, newest first. */
export async function fetchMyCreditBack(recipientId: string, limit = 50): Promise<SaleCommissionRow[]> {
  const { data, error } = await supabase
    .from("sale_commissions")
    .select(
      "id, sale_id, recipient_id, credits_consumed, commission_percent, commission_amount, reversed_at, created_at, voucher_sales(product_name, quantity, tx_id, buyer_id)",
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

