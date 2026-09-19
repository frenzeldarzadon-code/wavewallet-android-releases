/**
 * Coin loans inside the Wallet Center.
 *
 * Shows the split between free (spendable) coins and restricted loan coins,
 * the outstanding obligation, and the request / repay actions. Everything is a
 * preview: the database recomputes the automatic limit, the interest and every
 * restriction when the request is actually made.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { HandCoins, Info, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import { useOnline } from "@/lib/pwa";
import { notifyWalletChanged } from "@/lib/wallet-events";
import {
  cancelCoinLoan,
  fetchCoinLoanSettings,
  fetchMyCoinLoan,
  fetchMyLoanHistory,
  loanEntryLabel,
  loanStatusLabel,
  requestGoesToApproval,
  releasedCoins,
  repayCoinLoan,
  requestCoinLoan,
  upfrontInterest,
  validateLoanRequest,
  type CoinLoanEntry,
  type CoinLoanSettings,
  type CoinLoanSummary,
} from "@/lib/coin-loans";

export function CoinLoanCard({ onChanged }: { onChanged?: () => void }) {
  const online = useOnline();
  const [summary, setSummary] = useState<CoinLoanSummary | null>(null);
  const [settings, setSettings] = useState<CoinLoanSettings | null>(null);
  const [history, setHistory] = useState<CoinLoanEntry[]>([]);
  const [amount, setAmount] = useState("");
  const [repay, setRepay] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, cfg, h] = await Promise.all([
        fetchMyCoinLoan(),
        fetchCoinLoanSettings(),
        fetchMyLoanHistory().catch(() => []),
      ]);
      setSummary(s);
      setSettings(cfg);
      setHistory(h);
    } catch {
      /* the card simply stays hidden when it cannot load */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary || !settings) return null;
  // Loans switched off by the platform owner: nothing to show unless this
  // member still has a loan to repay or a request awaiting a decision.
  if (!summary.loansEnabled && !summary.loanId) return null;

  const requested = Number(amount) || 0;
  const manual = requestGoesToApproval(requested, summary);
  const interest = upfrontInterest(requested, settings);
  const net = releasedCoins(requested, settings);
  const active = summary.status === "active";
  const pending = summary.status === "pending";

  const submit = async () => {
    const problem = validateLoanRequest(requested, summary);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await requestCoinLoan(requested);
      toast.success(
        manual
          ? "Request sent. The platform owner will review it."
          : `Approved. ${peso(net)} added to your wallet as loan coins.`,
      );
      setAmount("");
      await load();
      notifyWalletChanged();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request the loan.");
    } finally {
      setBusy(false);
    }
  };

  const doRepay = async () => {
    const value = Number(repay) || 0;
    if (value <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const paid = await repayCoinLoan(value);
      toast.success(`${peso(paid)} repaid.`);
      setRepay("");
      await load();
      notifyWalletChanged();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not repay.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!summary.loanId) return;
    setBusy(true);
    try {
      await cancelCoinLoan(summary.loanId);
      toast.success("Request cancelled.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      devSlot="wallet-center.coin-loan"
      title="Coin loan"
      description={
        summary.universeSpend
          ? "Borrow coins against your Universe wallet. Loan coins can buy from any Universe shop, but can never be transferred, gifted or cashed out."
          : "Borrow coins against your Universe wallet. Loan coins can only buy from shops where you are an admin, reseller or subreseller."
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Free to spend"
          value={peso(summary.freeBalance)}
          hint="Transferable, spendable anywhere, and can be cashed out"
          icon={HandCoins}
          tone="positive"
        />
        <StatCard
          label="Loan coins (restricted)"
          value={peso(summary.restrictedBalance)}
          hint={
            summary.universeSpend
              ? "Spendable at any Universe shop — never transfers, gifts or cash out"
              : "Purchases in your own shops only — never transfers, gifts or cash out"
          }
          icon={Lock}
          tone="brand"
        />
        <StatCard
          label="Outstanding"
          value={peso(summary.outstanding)}
          hint={
            active
              ? `${summary.interestPercent}% monthly on what is left unpaid`
              : "Nothing owed right now"
          }
          icon={Info}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge tone={active ? "warning" : pending ? "brand" : "muted"}>
          {loanStatusLabel(summary.status)}
        </StatusBadge>
        <span>
          {summary.canAuto
            ? `Approved instantly up to ${peso(summary.autoLimit)} — the greater of ${peso(settings.baseCredits)} and ${settings.multiplier}× your free balance.`
            : "Every request is reviewed by the platform owner before coins are released."}
        </span>
      </div>

      {active ? (
        <Card className="mt-3 shadow-none">
          <CardContent className="space-y-3 py-4">
            <p className="text-xs text-muted-foreground">
              Borrowed {peso(summary.principal)} · received {peso(summary.releasedAmount)} after the
              first month's interest of {peso(summary.firstMonthInterest)}. Any top up you make pays
              this loan down first; only the excess becomes free coins.
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="loan-repay">Repay now</Label>
                <Input
                  id="loan-repay"
                  inputMode="decimal"
                  value={repay}
                  placeholder={String(summary.outstanding)}
                  onChange={(e) => setRepay(e.target.value)}
                />
              </div>
              <Button className="h-10" disabled={busy || !online} onClick={() => void doRepay()}>
                Repay
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : pending ? (
        <Card className="mt-3 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="text-xs text-muted-foreground">
              {peso(summary.principal)} is waiting for the platform owner's decision because it is
              above your automatic limit.
            </p>
            <Button variant="outline" size="sm" disabled={busy || !online} onClick={() => void cancel()}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : !summary.loansEnabled ? (
        <Card className="mt-3 shadow-none">
          <CardContent className="py-4 text-xs text-muted-foreground">
            New coin loans are paused by the platform owner right now.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-3 shadow-none">
          <CardContent className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="loan-amount">Amount to borrow</Label>
              <Input
                id="loan-amount"
                inputMode="decimal"
                value={amount}
                placeholder={String(settings.baseCredits)}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {needsId ? (
              <LoanIdPicker
                file={idFile}
                onPick={setIdFile}
                disabled={busy || !online}
                onError={(m) => toast.error(m)}
              />
            ) : null}
            <Button
              className="h-11 w-full"
              disabled={busy || !online || requested <= 0 || (needsId && !idFile)}
              onClick={() => void submit()}
            >
              {manual ? "Send for approval" : "Borrow"}
            </Button>
            {requested > 0 ? (
              <p className="text-xs text-muted-foreground">
                You would receive {peso(net)} now ({peso(interest)} first month interest at{" "}
                {settings.monthlyInterestPercent}%), and owe {peso(requested)}.{" "}
                {manual
                  ? "This is above your automatic limit, so the platform owner reviews it first."
                  : "This is within your automatic limit, so it is released immediately."}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {history.length ? (
        <div className="mt-3 space-y-1.5">
          {history.slice(0, 6).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
            >
              <span>{loanEntryLabel(e.kind)}</span>
              <span className="tabular-nums text-muted-foreground">
                {peso(e.amount)} · owed {peso(e.outstanding_after)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </PageSection>
  );
}
