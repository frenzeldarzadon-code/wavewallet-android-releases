/**
 * Platform-owner money settings: credit valuation, withdrawal fee and the
 * cashback distribution. Nothing here is hard-coded — the shop admin share is
 * always derived as the remainder so the split can never exceed a purchase.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminCashbackPercent,
  describeRate,
  fetchMoneySettings,
  quoteWithdrawal,
  saveMoneySettings,
  validateCashback,
  validateValuation,
  type MoneySettings,
} from "@/lib/wallet-money";
import { peso } from "@/lib/wavewallet";

export function MoneySettingsCard() {
  const [form, setForm] = useState<MoneySettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchMoneySettings().then(setForm);
  }, []);

  if (!form) return null;

  const set = (key: keyof MoneySettings, value: number) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const adminShare = adminCashbackPercent(form.cashbackReseller, form.cashbackSubreseller);

  const save = async () => {
    const problem =
      validateValuation(form.creditsPerUnit, form.phpPerUnit, form.feePercent) ??
      validateCashback(form.cashbackReseller, form.cashbackSubreseller);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await saveMoneySettings(form);
      toast.success("Money settings saved. Pending requests keep the rate they were submitted with.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const example = quoteWithdrawal(100, form);

  return (
    <Card className="mb-6 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Credit valuation, withdrawal fee & cashback</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ms-credits">Credits per unit</Label>
            <Input
              id="ms-credits"
              inputMode="decimal"
              value={form.creditsPerUnit}
              onChange={(e) => set("creditsPerUnit", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-php">Peso value of that unit</Label>
            <Input
              id="ms-php"
              inputMode="decimal"
              value={form.phpPerUnit}
              onChange={(e) => set("phpPerUnit", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-fee">Withdrawal fee (%)</Label>
            <Input
              id="ms-fee"
              inputMode="decimal"
              value={form.feePercent}
              onChange={(e) => set("feePercent", Number(e.target.value))}
            />
          </div>
        </div>
        <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          Current valuation: <span className="font-medium text-foreground">{describeRate(form)}</span>. A 100 credit
          cash out pays {peso(example.gross)} gross, {peso(example.fee)} fee, {peso(example.net)} net.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ms-sub">Subreseller cashback (%)</Label>
            <Input
              id="ms-sub"
              inputMode="numeric"
              value={form.cashbackSubreseller}
              onChange={(e) => set("cashbackSubreseller", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-res">Reseller cashback (%)</Label>
            <Input
              id="ms-res"
              inputMode="numeric"
              value={form.cashbackReseller}
              onChange={(e) => set("cashbackReseller", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Shop admin remainder</Label>
            <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm font-semibold">
              {adminShare}%
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Calculated automatically so the total never exceeds 100%. Cashback is released only for settled voucher
          purchases and is always recorded in the ledger with purchaser, beneficiary, rate and source sale.
        </p>

        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save money settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
