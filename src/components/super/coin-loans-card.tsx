/**
 * Platform owner: coin loan settings + the approval queue for requests above a
 * member's automatic limit. Every decision is re-checked in the database.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import {
  fetchAdminCoinLoans,
  fetchCoinLoanSettings,
  loanStatusLabel,
  reviewCoinLoan,
  saveCoinLoanSettings,
  type AdminCoinLoan,
  type CoinLoanSettings,
} from "@/lib/coin-loans";

export function CoinLoansCard() {
  const [form, setForm] = useState<CoinLoanSettings | null>(null);
  const [loans, setLoans] = useState<AdminCoinLoan[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cfg, rows] = await Promise.all([
      fetchCoinLoanSettings(),
      fetchAdminCoinLoans().catch(() => [] as AdminCoinLoan[]),
    ]);
    setForm(cfg);
    setLoans(rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!form) return null;

  const set = <K extends keyof CoinLoanSettings>(key: K, value: CoinLoanSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    if (form.baseCredits < 0 || form.multiplier < 0) {
      toast.error("The base amount and multiplier cannot be negative.");
      return;
    }
    if (form.monthlyInterestPercent < 0 || form.monthlyInterestPercent > 100) {
      toast.error("Monthly interest must be between 0% and 100%.");
      return;
    }
    setBusy(true);
    try {
      await saveCoinLoanSettings(form);
      toast.success("Loan settings saved. Existing loans keep the rate they were released with.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (loan: AdminCoinLoan, approve: boolean) => {
    setBusy(true);
    try {
      await reviewCoinLoan(loan.id, approve);
      toast.success(approve ? "Loan approved and released." : "Loan declined.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  };

  const pending = loans.filter((l) => l.status === "pending");
  const decided = loans.filter((l) => l.status !== "pending").slice(0, 10);

  return (
    <Card className="mb-6 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Coin loans</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Coin loans available</p>
            <p className="text-xs text-muted-foreground">
              For members who are an admin, reseller or subreseller of a shop.
            </p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="loan-base">Automatic approval base (coins)</Label>
            <Input
              id="loan-base"
              inputMode="decimal"
              value={form.baseCredits}
              onChange={(e) => set("baseCredits", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loan-multiplier">Free balance multiplier</Label>
            <Input
              id="loan-multiplier"
              inputMode="decimal"
              value={form.multiplier}
              onChange={(e) => set("multiplier", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loan-interest">Monthly interest (%)</Label>
            <Input
              id="loan-interest"
              inputMode="decimal"
              value={form.monthlyInterestPercent}
              onChange={(e) => set("monthlyInterestPercent", Number(e.target.value))}
            />
          </div>
          <div className="flex items-end justify-between gap-3 rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Take first month upfront</p>
              <p className="text-xs text-muted-foreground">Deducted from the coins released.</p>
            </div>
            <Switch
              checked={form.firstMonthUpfront}
              onCheckedChange={(v) => set("firstMonthUpfront", v)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A member is approved instantly up to the greater of {peso(form.baseCredits)} and{" "}
          {form.multiplier}× their free (unloaned) balance. Anything higher waits for you.
        </p>
        <Button disabled={busy} onClick={() => void save()}>
          Save loan settings
        </Button>

        <div className="space-y-2 pt-2">
          <p className="text-sm font-medium">Waiting for your decision ({pending.length})</p>
          {pending.length === 0 ? (
            <p className="text-xs text-muted-foreground">No loan requests waiting.</p>
          ) : (
            pending.map((l) => (
              <div key={l.id} className="rounded-lg border p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {l.full_name ?? "Member"} {l.handle ? `@${l.handle}` : ""}
                  </span>
                  <span className="tabular-nums">{peso(l.principal)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Automatic limit {peso(l.auto_limit_snapshot)} · free balance{" "}
                  {peso(l.free_balance_snapshot)} · first month interest{" "}
                  {peso(l.first_month_interest)} at {l.interest_percent}% · requested{" "}
                  {new Date(l.created_at).toLocaleString()}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void decide(l, true)}>
                    Approve &amp; release
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void decide(l, false)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {decided.length ? (
          <div className="space-y-1.5 pt-2">
            <p className="text-sm font-medium">Recent loans</p>
            {decided.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
              >
                <span>
                  {l.full_name ?? "Member"} · {peso(l.principal)}
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  owed {peso(l.outstanding)}
                  <StatusBadge
                    tone={l.status === "active" ? "warning" : l.status === "settled" ? "success" : "muted"}
                  >
                    {loanStatusLabel(l.status)}
                  </StatusBadge>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
