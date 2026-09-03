/**
 * Expense recorder for a shop admin (ecosystem scope) or the platform owner
 * (platform scope).
 *
 * Every entry is stored as an audited `business_expenses` record through the
 * `record_expense` database function, which re-checks the operator's scope
 * server-side. Expenses never touch a wallet or the credit ledger — they are a
 * reporting cost deducted from earnings to produce net earnings.
 */
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { shortDateTime } from "@/lib/wavewallet";
import {
  deleteExpense,
  expenseDisplayCategory,
  expenseDisplayDescription,
  fetchExpenses,
  recordExpense,
  totalExpenses,
  validateExpense,
  type ExpenseRow,
  type ExpenseScope,
} from "@/lib/expenses";

export function ExpensesCard({
  scope,
  ecosystemId,
  title = "Expenses",
  description,
  format,
  onChange,
}: {
  scope: ExpenseScope;
  ecosystemId?: string | null;
  title?: string;
  description?: string;
  format: (value: number) => string;
  /** Called after any successful write so the parent can refresh its totals. */
  onChange?: () => void;
}) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [amount, setAmount] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (scope === "ecosystem" && !ecosystemId) return;
    setLoading(true);
    try {
      setRows(await fetchExpenses({ scope, ecosystemId: ecosystemId ?? null }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope, ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const problem = validateExpense({ amount, description: descriptionText });
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await recordExpense({
        amount: Number(amount),
        description: descriptionText,
        scope,
        ecosystemId: ecosystemId ?? null,
        category,
      });
      setAmount("");
      setDescriptionText("");
      setCategory("");
      toast.success("Expense recorded");
      await load();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: ExpenseRow) => {
    try {
      await deleteExpense(row.id);
      toast.success("Expense removed");
      await load();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <PageSection devSlot="expenses-card.expenses"
      title={title}
      description={
        description ??
        "Recorded as audited entries with the operator, timestamp, amount and description. Expenses reduce net earnings only — no wallet or coin balance changes."
      }
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="expense-amount">Amount *</Label>
              <Input
                id="expense-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="expense-category">Category (optional)</Label>
              <Input
                id="expense-category"
                placeholder="Rewards shop, utilities, equipment…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="expense-description">Description *</Label>
            <Textarea
              id="expense-description"
              placeholder="What was this expense for?"
              value={descriptionText}
              onChange={(e) => setDescriptionText(e.target.value)}
              rows={2}
            />
          </div>
          <Button onClick={() => void submit()} disabled={busy} className="w-full sm:w-auto">
            {busy ? "Recording…" : "Record expense"}
          </Button>
        </CardContent>
      </Card>

      <div className="mt-3">
        {loading ? (
          <EmptyState title="Loading expenses…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No expenses recorded yet"
            description="Add an amount and description above to start tracking costs against your earnings."
          />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0">
              {rows.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{expenseDisplayDescription(r)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(r.spent_at)} · {r.created_by_name ?? "Operator"}
                      {expenseDisplayCategory(r) ? ` · ${expenseDisplayCategory(r)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold text-destructive">
                      -{format(r.amount)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete expense"
                      onClick={() => void remove(r)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
                <span>Total recorded</span>
                <span className="text-destructive">-{format(totalExpenses(rows))}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageSection>
  );
}
