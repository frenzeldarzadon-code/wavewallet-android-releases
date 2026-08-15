/**
 * Business expenses — shop (admin) and platform (super admin).
 *
 * Expenses are real audited records in `business_expenses`, written through the
 * `record_expense` database function, which re-checks the operator's scope
 * server-side (an admin may only ever write inside their own ecosystem) and
 * writes an operator audit entry. Nothing here changes a wallet balance or the
 * credit ledger: expenses are a reporting-side cost, deducted from earnings to
 * produce NET earnings, never from anyone's credits.
 */
import { supabase } from "@/integrations/supabase/client";
import { periodTotalsOf, subtractPeriods, type PeriodTotals } from "@/lib/earnings";

export type ExpenseScope = "ecosystem" | "platform";

/** Category used for every Lovable AI credit purchase recorded by the platform owner. */
export const LOVABLE_CREDITS_CATEGORY = "Lovable AI Credits";
/** Provider tag stored alongside those expenses. */
export const LOVABLE_PROVIDER = "Lovable";

export interface ExpenseRow {
  id: string;
  scope: ExpenseScope;
  ecosystem_id: string | null;
  amount: number;
  description: string;
  category: string | null;
  provider: string | null;
  provider_reference: string | null;
  currency: string | null;
  created_by: string;
  created_by_name: string | null;
  spent_at: string;
  created_at: string;
}

export interface ExpenseQuery {
  scope: ExpenseScope;
  ecosystemId?: string | null;
  from?: Date;
  to?: Date;
  limit?: number;
}

export async function fetchExpenses(q: ExpenseQuery): Promise<ExpenseRow[]> {
  let query = supabase
    .from("business_expenses")
    .select(
      "id, scope, ecosystem_id, amount, description, category, provider, provider_reference, currency, created_by, created_by_name, spent_at, created_at",
    )
    .eq("scope", q.scope)
    .order("spent_at", { ascending: false })
    .limit(q.limit ?? 200);
  if (q.scope === "ecosystem" && q.ecosystemId) query = query.eq("ecosystem_id", q.ecosystemId);
  if (q.from) query = query.gte("spent_at", q.from.toISOString());
  if (q.to) query = query.lte("spent_at", q.to.toISOString());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ExpenseRow[]).map((r) => ({ ...r, amount: Number(r.amount) }));
}


export interface NewExpense {
  amount: number;
  description: string;
  scope: ExpenseScope;
  ecosystemId?: string | null;
  category?: string | null;
  spentAt?: Date | null;
}

/** Client-side mirror of the database validation, for instant form feedback. */
export function validateExpense(input: {
  amount: string | number;
  description: string;
}): string | null {
  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero.";
  if (!input.description.trim()) return "Enter a description for this expense.";
  return null;
}

export async function recordExpense(input: NewExpense): Promise<void> {
  const problem = validateExpense({ amount: input.amount, description: input.description });
  if (problem) throw new Error(problem);
  const args: {
    _amount: number;
    _description: string;
    _scope: string;
    _ecosystem_id?: string;
    _category?: string;
    _spent_at?: string;
  } = {
    _amount: input.amount,
    _description: input.description.trim(),
    _scope: input.scope,
  };
  if (input.scope === "ecosystem" && input.ecosystemId) args._ecosystem_id = input.ecosystemId;
  if (input.category?.trim()) args._category = input.category.trim();
  if (input.spentAt) args._spent_at = input.spentAt.toISOString();
  const { error } = await supabase.rpc("record_expense", args);

  if (error) throw new Error(error.message);
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_expense", { _id: id });
  if (error) throw new Error(error.message);
}

/** Today / month / quarter / year expense totals in the reporting timezone. */
export function expensePeriodTotals(rows: ExpenseRow[]): PeriodTotals {
  return periodTotalsOf(rows, (r) => r.spent_at, (r) => r.amount);
}

export const totalExpenses = (rows: ExpenseRow[]) => rows.reduce((s, r) => s + r.amount, 0);

/** Net = earnings − expenses, per period. Never clamped: a loss stays a loss. */
export function netAfterExpenses(earnings: PeriodTotals, expenses: PeriodTotals): PeriodTotals {
  return subtractPeriods(earnings, expenses);
}
