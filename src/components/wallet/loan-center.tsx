/**
 * Loan Center — the one place a member sees everything about borrowing.
 *
 * Every figure comes from the loan record in the database through
 * `my_coin_loan_summary` / `my_coin_loans` / `my_coin_loan_history`, so the
 * Android app and the web/PWA always show exactly the same balance. Nothing is
 * cached or recomputed here: the amounts previewed before a request are the
 * same formulas the database applies when it actually books the loan.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, HandCoins, Info, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { useOnline } from "@/lib/pwa";
import { notifyWalletChanged } from "@/lib/wallet-events";
import {
  cancelCoinLoan,
  fetchCoinLoanSettings,
  fetchMyCoinLoan,
  fetchMyLoanHistory,
  fetchMyLoans,
  loanEntryLabel,
  loanIdRequired,
  loanStatusLabel,
  releasedCoins,
  removeLoanIdDocument,
  repayCoinLoan,
  requestCoinLoan,
  requestGoesToApproval,
  upfrontInterest,
  uploadLoanIdDocument,
  validateLoanSubmission,
  type CoinLoanEntry,
  type CoinLoanSettings,
  type CoinLoanSummary,
  type MyCoinLoan,
} from "@/lib/coin-loans";
import { LoanIdPicker, LoanIdViewer } from "@/components/wallet/loan-id-document";
import { supabase } from "@/integrations/supabase/client";

export function LoanCenter() {
  const online = useOnline();
  const [summary, setSummary] = useState<CoinLoanSummary | null>(null);
  const [settings, setSettings] = useState<CoinLoanSettings | null>(null);
  const [loans, setLoans] = useState<MyCoinLoan[]>([]);
  const [history, setHistory] = useState<CoinLoanEntry[]>([]);
  const [amount, setAmount] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [repay, setRepay] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, cfg, list, h] = await Promise.all([
        fetchMyCoinLoan(),
        fetchCoinLoanSettings(),
        fetchMyLoans().catch(() => [] as MyCoinLoan[]),
        fetchMyLoanHistory().catch(() => [] as CoinLoanEntry[]),
      ]);
      setSummary(s);
      setSettings(cfg);
      setLoans(list);
      setHistory(h);
    } catch (e) {
      toast.error("Could not load your loan details", { description: (e as Error).message });
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return null;
  if (!summary || !settings) {
    return <EmptyState title="Loans are unavailable right now" description="Please try again." />;
  }

  const requested = Number(amount) || 0;
  const goesToApproval = requestGoesToApproval(requested, summary);
  const interest = upfrontInterest(requested, settings);
  const net = releasedCoins(requested, settings);
  const active = summary.status === "active";
  const pending = summary.status === "pending";
  const capacity = summary.canAuto ? Math.max(summary.autoLimit, 0) : 0;
  const repayments = history.filter((e) => e.kind === "repayment");
  const needsId = loanIdRequired(summary);

  const submit = async () => {
    const problem = validateLoanSubmission(requested, summary, Boolean(idFile));
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (needsId && idFile) {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id;
        if (!uid) throw new Error("Please sign in again.");
        uploaded = await uploadLoanIdDocument(uid, idFile);
      }
      await requestCoinLoan(requested, uploaded);
      toast.success(
        goesToApproval
          ? "Request sent with your ID. The platform owner will review it."
          : `Approved. ${peso(net)} added to your wallet as loan coins.`,
      );
      setAmount("");
      setIdFile(null);
      await load();
      notifyWalletChanged();
    } catch (e) {
      // The request was refused, so the just-uploaded ID is not attached to any
      // loan — remove it rather than leaving a stray file behind.
      if (uploaded) await removeLoanIdDocument(uploaded).catch(() => undefined);
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
    <div className="pb-8">
      <PageSection
        title="What you owe"
        description="Read straight from your loan record — the same figures in the app and on the web."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Amount owed now"
            value={peso(summary.outstanding)}
            icon={HandCoins}
            tone={summary.outstanding > 0 ? "negative" : "neutral"}
            hint={active ? `${summary.interestPercent}% monthly while unpaid` : "Nothing owed"}
          />
          <StatCard
            label="Borrowed"
            value={peso(active || pending ? summary.principal : 0)}
            icon={Coins}
            hint={active ? `${peso(summary.releasedAmount)} received` : "No loan running"}
          />
          <StatCard
            label="Interest added"
            value={peso(summary.accruedInterest)}
            icon={Info}
            hint={`First month ${peso(summary.firstMonthInterest)}`}
          />
          <StatCard
            label="Loan coins (restricted)"
            value={peso(summary.restrictedBalance)}
            icon={Lock}
            tone="brand"
            hint={
              summary.universeSpend
                ? "Spendable at any Universe shop — never transfers, gifts or cash out"
                : "Purchases in your own shops only — never transfers, gifts or cash out"
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone={active ? "warning" : pending ? "brand" : "muted"}>
            {loanStatusLabel(summary.status)}
          </StatusBadge>
          <span>Free coins to spend anywhere: {peso(summary.freeBalance)}</span>
        </div>
      </PageSection>

      <PageSection
        title="Borrow"
        description={
          summary.canAuto
            ? `Approved instantly up to ${peso(capacity)} — the greater of ${peso(settings.baseCredits)} and ${settings.multiplier}× your free balance. Larger amounts go to the platform owner.`
            : "Every request is reviewed by the platform owner before any coins are released."
        }
      >
        {active ? (
          <Card className="shadow-none">
            <CardContent className="space-y-3 py-4">
              <p className="text-xs text-muted-foreground">
                Borrowed {peso(summary.principal)} · received {peso(summary.releasedAmount)} after
                the first month's interest of {peso(summary.firstMonthInterest)}. Any top up pays
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
          <Card className="shadow-none">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-xs text-muted-foreground">
                {peso(summary.principal)} is waiting for the platform owner's decision.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !online}
                onClick={() => void cancel()}
              >
                Cancel request
              </Button>
            </CardContent>
          </Card>
        ) : !summary.loansEnabled ? (
          <Card className="shadow-none">
            <CardContent className="py-4 text-xs text-muted-foreground">
              New coin loans are paused by the platform owner right now.
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-none">
            <CardContent className="space-y-3 py-4">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="loan-amount">Amount to borrow</Label>
                  <Input
                    id="loan-amount"
                    inputMode="decimal"
                    value={amount}
                    placeholder={String(settings.baseCredits)}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <Button
                  className="h-10"
                  disabled={busy || !online || requested <= 0}
                  onClick={() => void submit()}
                >
                  {goesToApproval ? "Send for approval" : "Borrow"}
                </Button>
              </div>
              {requested > 0 ? (
                <p className="text-xs text-muted-foreground">
                  You would receive {peso(net)} now ({peso(interest)} first month interest at{" "}
                  {settings.monthlyInterestPercent}%), and owe {peso(requested)}.{" "}
                  {goesToApproval
                    ? "The platform owner reviews this before any coins are released."
                    : "This is within your automatic limit, so it is released immediately."}
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <PageSection title="Your loans" description="Every loan you have had, newest first.">
        {loans.length === 0 ? (
          <EmptyState title="No loans yet" description="Your borrowing history will appear here." />
        ) : (
          <div className="space-y-2">
            {loans.map((l) => (
              <div key={l.id} className="rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{peso(l.principal)} borrowed</span>
                  <StatusBadge
                    tone={
                      l.status === "active"
                        ? "warning"
                        : l.status === "settled"
                          ? "success"
                          : l.status === "pending"
                            ? "brand"
                            : "muted"
                    }
                  >
                    {loanStatusLabel(l.status)}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {shortDateTime(l.created_at)} · received {peso(l.released_amount)} · interest{" "}
                  {peso(l.accrued_interest)} · owed {peso(l.outstanding)}
                  {l.origin === "super_admin_manual" ? " · added by the platform owner" : ""}
                  {l.reference_note ? ` · ${l.reference_note}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="Repayments" description="Every payment recorded against your loans.">
        {repayments.length === 0 ? (
          <EmptyState title="No repayments yet" />
        ) : (
          <div className="space-y-1.5">
            {repayments.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
              >
                <span>{shortDateTime(e.created_at)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {peso(e.amount)} paid · owed after {peso(e.outstanding_after)}
                </span>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="Loan activity" description="Releases, interest and repayments in order.">
        {history.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <div className="space-y-1.5">
            {history.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
              >
                <span>
                  {loanEntryLabel(e.kind)} · {shortDateTime(e.created_at)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {peso(e.amount)} · owed {peso(e.outstanding_after)}
                </span>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}
