/**
 * Super Admin only — record a Lovable AI credit purchase as a platform expense.
 *
 * PLATFORM LIMITATION: Lovable billing does not expose a purchase API or
 * webhook to this project, so purchases cannot be imported automatically. The
 * platform owner enters the real PHP amount and receipt reference here; nothing
 * is ever estimated. Entries land in `business_expenses` (platform scope) via
 * `record_expense`, so they flow into the same expense totals and net-earnings
 * figures as every other platform cost, and are written to the operator audit
 * log. Duplicate receipts are rejected by the provider-reference unique index;
 * when a receipt has no reference, a same-day same-amount match asks for
 * confirmation instead of silently duplicating.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import {
  fetchExpenses,
  findLikelyDuplicates,
  recordLovableCreditPurchase,
  totalLovableCredits,
  validateLovablePurchase,
  type ExpenseRow,
} from "@/lib/expenses";

const today = () => new Date().toISOString().slice(0, 10);

export function LovableCreditsCard({ onChange }: { onChange?: () => void }) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchExpenses({ scope: "platform" }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const purchasedAt = new Date(`${date}T00:00:00`);
    const problem = validateLovablePurchase({ amountPhp: amount, purchasedAt });
    if (problem) {
      toast.error(problem);
      return;
    }
    const input = {
      amountPhp: Number(amount),
      purchasedAt,
      reference: reference.trim() || null,
      note: note.trim() || null,
    };
    const dupes = findLikelyDuplicates(rows, input);
    if (dupes.length > 0 && !reference.trim() && !confirmDuplicate) {
      setConfirmDuplicate(true);
      toast.warning(
        "A Lovable purchase with the same amount is already recorded for that date. Press again to confirm it is a separate purchase.",
      );
      return;
    }
    setBusy(true);
    try {
      await recordLovableCreditPurchase(input);
      setAmount("");
      setReference("");
      setNote("");
      setConfirmDuplicate(false);
      toast.success("Lovable credit purchase recorded");
      await load();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      title="Lovable AI credits"
      description="Record what you actually paid for Lovable credits. Lovable billing offers no purchase webhook to this app, so entries are added from your receipt — they are never estimated. Each one is a platform operating expense counted in total expenses and net earnings."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="lovable-amount">Amount paid (PHP) *</Label>
              <Input
                id="lovable-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmDuplicate(false);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lovable-date">Purchase date *</Label>
              <Input
                id="lovable-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setConfirmDuplicate(false);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lovable-ref">Receipt / transaction ID</Label>
              <Input
                id="lovable-ref"
                placeholder="Optional, prevents duplicates"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lovable-note">Note (optional)</Label>
            <Input
              id="lovable-note"
              placeholder="Top-up plan, seat count…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button onClick={() => void submit()} disabled={busy} className="w-full sm:w-auto">
              {busy
                ? "Recording…"
                : confirmDuplicate
                  ? "Confirm separate purchase"
                  : "Record Lovable credit purchase"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Recorded so far:{" "}
              <span className="font-semibold text-destructive">
                -{peso(totalLovableCredits(rows))}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </PageSection>
  );
}
