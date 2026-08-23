/**
 * Spending Tracker — Admin reporting/analytics ONLY.
 *
 * Nothing in this module moves money. Every automatic figure is DERIVED from
 * records that already exist:
 *
 *  - Admin cashback income  → `spending_auto_entries`, which reads the shop's
 *    admin earnings out of `earnings_history` (the same source the Reports and
 *    dashboard earnings use) and attributes each amount to the TOP-LEVEL
 *    reseller of the buyer's existing downline chain. Cashback that belongs to
 *    a reseller or subreseller is never counted here — only what the admin
 *    actually earned.
 *  - Admin Discount income  → the discount snapshotted on the admin's own
 *    `voucher_sales` rows. Never manually entered, never double counted.
 *  - Admin Purchases expense → the ACTUAL amount paid (`sale_price`), never the
 *    pre-discount list value.
 *
 * Manual expenses reuse the existing `business_expenses` store (so the shop has
 * a single expense source of truth); only manual income has its own table.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  monthBounds,
  quarterBounds,
  quarterValue,
  yearBounds,
  yearValue,
} from "@/lib/reports";

export type EntryKind = "income" | "expense";

export interface SpendingCategory {
  id: string;
  ecosystem_id: string;
  kind: EntryKind;
  /** Editable display name. Renaming never changes `auto_key` / `member_id`. */
  name: string;
  /** Stable machine link for automatic categories. NULL for manual ones. */
  auto_key: string | null;
  member_id: string | null;
}

export interface SpendingEntry {
  id: string;
  kind: EntryKind;
  occurredAt: string;
  description: string;
  amount: number;
  source: "automatic" | "manual";
  /** `auto_key` for automatic entries, `cat:<id>` / `uncategorized` otherwise. */
  categoryKey: string;
  categoryName: string;
  memberId: string | null;
  memberName: string | null;
  notes: string | null;
  /** Manual entries only: automatic ones are derived and can never be edited. */
  editable: boolean;
  /**
   * Set only for entries saved on this device that the server has not
   * confirmed yet. Absent means the row came back from the server.
   */
  sync?: "pending" | "failed";
}

/* ------------------------------------------------------------------ */
/* Period filter                                                       */
/* ------------------------------------------------------------------ */

export type PeriodMode = "month" | "quarter" | "year" | "day" | "range";

export interface PeriodFilter {
  mode: PeriodMode;
  /** `YYYY-MM` for month mode. */
  month?: string;
  /** `YYYY-Qn` for quarter mode. */
  quarter?: string;
  /** `YYYY` for year mode. */
  year?: string;
  /** `YYYY-MM-DD` for day mode. */
  day?: string;
  /** `YYYY-MM-DD` bounds for range mode. */
  from?: string;
  to?: string;
}

export interface ResolvedPeriod {
  from: Date;
  to: Date;
  label: string;
}

const startOfDay = (iso: string) => new Date(`${iso}T00:00:00.000`);
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999`);

export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const dayKey = (d: Date) =>
  `${monthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;

export const quarterKey = quarterValue;
export const yearKey = yearValue;

/**
 * Turns the UI filter into concrete bounds. Calendar periods share the report
 * range helpers, so a month, quarter or year here covers exactly the same
 * inclusive local-time window the Reports page uses. Invalid input falls back
 * to the current month.
 */
export function resolvePeriod(filter: PeriodFilter, now = new Date()): ResolvedPeriod {
  const wrap = (r: { start: Date; end: Date; label: string }): ResolvedPeriod => ({
    from: r.start,
    to: r.end,
    label: r.label,
  });
  if (filter.mode === "day" && filter.day) {
    return {
      from: startOfDay(filter.day),
      to: endOfDay(filter.day),
      label: new Date(`${filter.day}T00:00:00`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    };
  }
  if (filter.mode === "range" && filter.from && filter.to) {
    const a = filter.from <= filter.to ? filter.from : filter.to;
    const b = filter.from <= filter.to ? filter.to : filter.from;
    return { from: startOfDay(a), to: endOfDay(b), label: `${a} → ${b}` };
  }
  if (filter.mode === "quarter") return wrap(quarterBounds(filter.quarter ?? quarterValue(now), now));
  if (filter.mode === "year") return wrap(yearBounds(filter.year ?? yearValue(now), now));
  return wrap(monthBounds(filter.month ?? monthKey(now), now));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function syncSpendingCategories(ecosystemId: string): Promise<void> {
  const { error } = await supabase.rpc("spending_sync_categories", { _ecosystem: ecosystemId });
  if (error) throw new Error(error.message);
}

export async function fetchSpendingCategories(
  ecosystemId: string,
): Promise<SpendingCategory[]> {
  const { data, error } = await supabase
    .from("spending_categories")
    .select("id, ecosystem_id, kind, name, auto_key, member_id")
    .eq("ecosystem_id", ecosystemId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SpendingCategory[];
}

interface AutoRow {
  id: string;
  kind: string;
  occurred_at: string;
  description: string;
  amount: number | string;
  auto_key: string;
  member_id: string | null;
  member_name: string | null;
}

/** Display name for an automatic category, honouring any admin rename. */
export function autoCategoryName(
  autoKey: string,
  categories: SpendingCategory[],
  kind: EntryKind,
  fallbackMember?: string | null,
): string {
  const hit = categories.find((c) => c.auto_key === autoKey && c.kind === kind);
  if (hit) return hit.name;
  if (autoKey === "admin_discount") return "Admin Discount";
  if (autoKey === "admin_purchases") return "Admin Purchases";
  if (autoKey === "direct") return "Direct sales";
  return fallbackMember ?? "Reseller";
}

/**
 * Automatic entries are INCOME ONLY. Expenses are manual, so any automatic
 * expense row (a legacy `admin_purchases` row from an older database function)
 * is dropped here as a second line of defence against double counting.
 */
const isAutomaticIncome = (r: AutoRow) => r.kind !== "expense";

export async function fetchSpendingEntries(
  ecosystemId: string,
  period: ResolvedPeriod,
  categories: SpendingCategory[],
): Promise<SpendingEntry[]> {
  const fromIso = period.from.toISOString();
  const toIso = period.to.toISOString();

  const [auto, income, expenses] = await Promise.all([
    supabase.rpc("spending_auto_entries", {
      _ecosystem: ecosystemId,
      _from: fromIso,
      _to: toIso,
    }),
    supabase
      .from("spending_income_entries")
      .select("id, amount, description, category_id, notes, occurred_at")
      .eq("ecosystem_id", ecosystemId)
      .gte("occurred_at", fromIso)
      .lte("occurred_at", toIso)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("business_expenses")
      .select("id, amount, description, category, category_id, notes, spent_at")
      .eq("scope", "ecosystem")
      .eq("ecosystem_id", ecosystemId)
      .gte("spent_at", fromIso)
      .lte("spent_at", toIso)
      .order("spent_at", { ascending: false }),
  ]);

  if (auto.error) throw new Error(auto.error.message);
  if (income.error) throw new Error(income.error.message);
  if (expenses.error) throw new Error(expenses.error.message);

  const byId = new Map(categories.map((c) => [c.id, c]));

  const autoRows = ((auto.data ?? []) as unknown as AutoRow[]).filter(isAutomaticIncome);
  const seenAuto = new Set<string>();
  const autoEntries: SpendingEntry[] = autoRows
    // Stable source ids (`cb:<earning>`, `ad:<sale>`) guarantee one entry per
    // source transaction even if the server ever returns a row twice.
    .filter((r) => (seenAuto.has(r.id) ? false : (seenAuto.add(r.id), true)))
    .map((r) => ({
      id: r.id,
      kind: "income" as const,
      occurredAt: r.occurred_at,
      description: r.description,
      amount: Number(r.amount ?? 0),
      source: "automatic" as const,
      categoryKey: r.auto_key,
      categoryName: autoCategoryName(r.auto_key, categories, "income", r.member_name),
      memberId: r.member_id,
      memberName: r.member_name,
      notes: null,
      editable: false,
    }));

  const manualIncome: SpendingEntry[] = (
    (income.data ?? []) as unknown as {
      id: string;
      amount: number | string;
      description: string;
      category_id: string | null;
      notes: string | null;
      occurred_at: string;
    }[]
  ).map((r) => {
    const cat = r.category_id ? byId.get(r.category_id) : undefined;
    return {
      id: r.id,
      kind: "income" as const,
      occurredAt: r.occurred_at,
      description: r.description,
      amount: Number(r.amount ?? 0),
      source: "manual" as const,
      categoryKey: cat ? `cat:${cat.id}` : "uncategorized",
      categoryName: cat?.name ?? "Uncategorized",
      memberId: cat?.member_id ?? null,
      memberName: null,
      notes: r.notes,
      editable: true,
    };
  });

  const manualExpenses: SpendingEntry[] = (
    (expenses.data ?? []) as unknown as {
      id: string;
      amount: number | string;
      description: string;
      category: string | null;
      category_id: string | null;
      notes: string | null;
      spent_at: string;
    }[]
  ).map((r) => {
    const cat = r.category_id ? byId.get(r.category_id) : undefined;
    return {
      id: r.id,
      kind: "expense" as const,
      occurredAt: r.spent_at,
      description: r.description,
      amount: Number(r.amount ?? 0),
      source: "manual" as const,
      categoryKey: cat ? `cat:${cat.id}` : "uncategorized",
      categoryName: cat?.name ?? r.category ?? "Uncategorized",
      memberId: cat?.member_id ?? null,
      memberName: null,
      notes: r.notes,
      editable: true,
    };
  });

  return [...autoEntries, ...manualIncome, ...manualExpenses].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
}

/* ------------------------------------------------------------------ */
/* Writes (manual entries + category names)                            */
/* ------------------------------------------------------------------ */

export interface ManualEntryInput {
  ecosystemId: string;
  kind: EntryKind;
  amount: number;
  description: string;
  categoryId: string | null;
  occurredAt: Date;
  notes?: string | null;
  /**
   * Client-generated idempotency key. Sending the same key twice returns the
   * entry that already exists instead of creating a duplicate, which is what
   * makes replaying the offline queue safe.
   */
  clientRef?: string | null;
}

export function validateManualEntry(input: {
  amount: string | number;
  description: string;
  date?: string;
}): string | null {
  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero.";
  if (!input.description.trim()) return "Enter a description.";
  if (input.date !== undefined && !input.date) return "Choose a date.";
  return null;
}

export async function saveManualEntry(input: ManualEntryInput, id?: string): Promise<void> {
  const problem = validateManualEntry({ amount: input.amount, description: input.description });
  if (problem) throw new Error(problem);
  const shared = {
    _amount: input.amount,
    _description: input.description.trim(),
    _category_id: input.categoryId,
    _notes: input.notes?.trim() || null,
  };
  const ref = input.clientRef ?? null;
  const rpc =
    input.kind === "income"
      ? id
        ? { fn: "spending_update_income", args: { _id: id, ...shared, _occurred_at: input.occurredAt.toISOString() } }
        : { fn: "spending_record_income", args: { _ecosystem: input.ecosystemId, ...shared, _occurred_at: input.occurredAt.toISOString(), _client_ref: ref } }
      : id
        ? { fn: "spending_update_expense", args: { _id: id, ...shared, _spent_at: input.occurredAt.toISOString() } }
        : { fn: "spending_record_expense", args: { _ecosystem: input.ecosystemId, ...shared, _spent_at: input.occurredAt.toISOString(), _client_ref: ref } };
  const { error } = await supabase.rpc(
    rpc.fn as "spending_record_income",
    rpc.args as never,
  );
  if (error) throw new Error(error.message);
}

export async function deleteManualEntry(kind: EntryKind, id: string): Promise<void> {
  const { error } =
    kind === "income"
      ? await supabase.rpc("spending_delete_income", { _id: id })
      : await supabase.rpc("delete_expense", { _id: id });
  if (error) throw new Error(error.message);
}

export async function createCategory(
  ecosystemId: string,
  kind: EntryKind,
  name: string,
): Promise<void> {
  const { error } = await supabase
    .from("spending_categories")
    .insert({ ecosystem_id: ecosystemId, kind, name: name.trim() });
  if (error) throw new Error(error.message);
}

/** Renames a category. Automatic ones keep their reseller link (enforced in the database). */
export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("spending_categories")
    .update({ name: name.trim() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from("spending_categories").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Pure reporting maths                                                */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SpendingSummary {
  income: number;
  expense: number;
  balance: number;
}

export function summarize(entries: SpendingEntry[]): SpendingSummary {
  const income = round2(
    entries.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0),
  );
  const expense = round2(
    entries.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amount, 0),
  );
  return { income, expense, balance: round2(income - expense) };
}

export interface CategoryTotal {
  key: string;
  name: string;
  total: number;
  share: number;
  automatic: boolean;
}

/** Category totals for one side, biggest first. Empty categories are dropped. */
export function categoryTotals(entries: SpendingEntry[], kind: EntryKind): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const e of entries) {
    if (e.kind !== kind) continue;
    const hit = map.get(e.categoryKey);
    if (hit) hit.total = round2(hit.total + e.amount);
    else
      map.set(e.categoryKey, {
        key: e.categoryKey,
        name: e.categoryName,
        total: round2(e.amount),
        share: 0,
        automatic: e.source === "automatic",
      });
  }
  const rows = [...map.values()].filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  return rows.map((r) => ({ ...r, share: sum > 0 ? round2((r.total / sum) * 100) : 0 }));
}

export interface Bucket {
  label: string;
  income: number;
  expense: number;
}

/** Income vs expense buckets: by day for short periods, by month for long ones. */
export function timeBuckets(entries: SpendingEntry[], period: ResolvedPeriod): Bucket[] {
  const spanDays = Math.max(
    1,
    Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000),
  );
  const byMonth = spanDays > 62;
  const map = new Map<string, Bucket>();
  for (const e of entries) {
    const d = new Date(e.occurredAt);
    const key = byMonth ? monthKey(d) : dayKey(d);
    const label = byMonth
      ? d.toLocaleDateString(undefined, { month: "short" })
      : String(d.getDate());
    const hit = map.get(key) ?? { label, income: 0, expense: 0 };
    if (e.kind === "income") hit.income = round2(hit.income + e.amount);
    else hit.expense = round2(hit.expense + e.amount);
    map.set(key, hit);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
}

export interface CategoryHighlight {
  topIncome: CategoryTotal | null;
  topExpense: CategoryTotal | null;
  income: CategoryTotal[];
  expense: CategoryTotal[];
}

export function categoryHighlights(entries: SpendingEntry[]): CategoryHighlight {
  const income = categoryTotals(entries, "income");
  const expense = categoryTotals(entries, "expense");
  return {
    income,
    expense,
    topIncome: income[0] ?? null,
    topExpense: expense[0] ?? null,
  };
}
